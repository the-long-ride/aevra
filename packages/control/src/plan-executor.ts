import type {
  ControlError,
  ControlObservation,
  ControlPlan,
  ControlPlanResult,
  ControlPlanStepResult,
  ControlStep,
  ControlTarget,
} from '../../protocol/src/control.js';
import { ObservationStore } from './observation-store.js';
import type { ControlAdapter } from './adapter.js';
import { ControlAdapterError } from './adapter.js';
import { ControlPlanJournal } from './plan-journal.js';
import { ResourceScheduler } from './resource-scheduler.js';
import {
  evaluateControlPredicate,
  resolveControlTarget,
  supportsControlAction,
} from './target-resolver.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function asControlError(error: unknown, stepId?: string): ControlError {
  if (error instanceof ControlAdapterError) {
    return {
      code: error.code,
      ...(stepId ? { stepId } : {}),
      dispatchState: error.dispatchState,
      recovery: error.recovery,
      message: error.message,
    };
  }
  const value = error as {
    code?: string;
    message?: string;
    dispatchState?: ControlError['dispatchState'];
  };
  return {
    code: value?.code ?? 'CONTROL_EXECUTION_FAILED',
    ...(stepId ? { stepId } : {}),
    dispatchState: value?.dispatchState ?? 'notDispatched',
    recovery: 'none',
    message: value?.message ?? String(error),
  };
}

function nodeBudget(maxOutputTokens: number): number {
  return Math.max(1, Math.min(500, Math.floor(maxOutputTokens / 12)));
}

export class PlanExecutor {
  constructor(
    readonly observations = new ObservationStore(),
    readonly journal = new ControlPlanJournal(),
    private readonly scheduler = new ResourceScheduler(),
  ) {}

  status(owner: string, planId: string) {
    return this.journal.get(owner, planId);
  }

  cancel(owner: string, planId: string): boolean {
    return this.journal.cancel(owner, planId);
  }

  async execute(
    owner: string,
    plan: ControlPlan,
    adapters: Map<string, ControlAdapter>,
  ): Promise<ControlPlanResult> {
    const claim = this.journal.claim(owner, plan);
    if (claim.existing && claim.record.result) return claim.record.result;
    if (claim.existing) {
      const code =
        claim.record.status === 'running' ? 'CONTROL_PLAN_RUNNING' : 'CONTROL_REQUEST_ALREADY_USED';
      throw Object.assign(
        new Error(
          `${code}: requestId already belongs to plan ${claim.record.planId} (${claim.record.status})`,
        ),
        { code },
      );
    }
    const planId = claim.record.planId;
    const startedAt = Date.now();
    const results = new Map<string, ControlPlanStepResult>();

    try {
      for (const surfaceId of plan.surfaceIds) {
        const adapter = adapters.get(surfaceId);
        if (!adapter) {
          return this.finish(owner, {
            planId,
            status: 'needsContext',
            steps: [],
            error: {
              code: 'CONTROL_SURFACE_NOT_FOUND',
              dispatchState: 'notDispatched',
              recovery: 'needsContext',
              message: `Surface ${surfaceId} has not been observed in this session`,
            },
            checkpoint: {
              reason: 'needsContext',
              nextAction: `Observe ${surfaceId} again before executing the plan.`,
            },
          });
        }
        if (adapter.mode !== plan.mode) {
          return this.finish(owner, {
            planId,
            status: 'needsContext',
            steps: [],
            error: {
              code: 'CONTROL_MODE_MISMATCH',
              dispatchState: 'notDispatched',
              recovery: plan.mode === 'isolated' ? 'chooseIsolatedRunner' : 'needsContext',
              message: `Surface ${surfaceId} is bound to ${adapter.mode}, not ${plan.mode}`,
            },
            checkpoint: {
              reason: plan.mode === 'isolated' ? 'chooseIsolatedRunner' : 'needsContext',
              nextAction:
                plan.mode === 'isolated'
                  ? 'Choose a verified isolated runner for this plan.'
                  : 'Observe the surface in shared semantic mode.',
            },
          });
        }
        const current = this.observations.get(owner, surfaceId);
        if (!current || current.observationId !== plan.expectedObservations[surfaceId]) {
          return this.finish(owner, {
            planId,
            status: 'needsContext',
            steps: [],
            error: {
              code: 'CONTROL_OBSERVATION_STALE',
              dispatchState: 'notDispatched',
              recovery: 'refresh',
              observationId: current?.observationId,
              message: `Expected observation for ${surfaceId} is no longer current`,
            },
            checkpoint: {
              reason: 'needsContext',
              nextAction: `Refresh ${surfaceId} and submit a plan against the new observation.`,
            },
          });
        }
      }

      const pending = new Map(plan.steps.map((step) => [step.id, step]));
      while (pending.size > 0) {
        if (this.journal.isCancelled(owner, planId)) {
          for (const step of pending.values()) {
            results.set(step.id, { id: step.id, status: 'cancelled', postcondition: 'notChecked' });
          }
          return this.finish(owner, {
            planId,
            status: 'cancelled',
            steps: plan.steps.map((step) => results.get(step.id)!).filter(Boolean),
          });
        }
        if (Date.now() - startedAt >= plan.deadlineMs) {
          const step = [...pending.values()][0];
          return this.fail(owner, planId, plan, results, step, {
            code: 'CONTROL_DEADLINE_EXCEEDED',
            stepId: step?.id,
            dispatchState: 'notDispatched',
            recovery: 'none',
            message: 'Control plan exceeded its deadline before the next step dispatched',
          });
        }

        const ready = [...pending.values()].filter((step) =>
          step.dependsOn.every((dependency) => results.has(dependency)),
        );
        if (ready.length === 0) {
          return this.fail(owner, planId, plan, results, undefined, {
            code: 'CONTROL_DEPENDENCY_DEADLOCK',
            dispatchState: 'notDispatched',
            recovery: 'none',
            message: 'No control step can make progress',
          });
        }

        let skipped = false;
        for (const step of ready) {
          if (
            step.dependsOn.some((dependency) => results.get(dependency)?.status !== 'succeeded')
          ) {
            results.set(step.id, { id: step.id, status: 'skipped', postcondition: 'notChecked' });
            pending.delete(step.id);
            skipped = true;
          }
        }
        if (skipped) continue;

        const wave = ready.slice(0, plan.maxConcurrency);
        for (const step of wave) pending.delete(step.id);
        const settled = await Promise.allSettled(
          wave.map((step) =>
            this.scheduler.run([`surface:${step.surfaceId}`], () =>
              this.executeStep(owner, planId, step, adapters.get(step.surfaceId)!),
            ),
          ),
        );

        let firstError: ControlError | undefined;
        for (let index = 0; index < wave.length; index += 1) {
          const step = wave[index]!;
          const outcome = settled[index]!;
          if (outcome.status === 'fulfilled') {
            results.set(step.id, outcome.value);
            continue;
          }
          const controlError = asControlError(outcome.reason, step.id);
          firstError ??= controlError;
          this.journal.recordStep(
            owner,
            planId,
            step.id,
            step.action.op,
            controlError.dispatchState,
            controlError.dispatchState === 'unknown' ? 'unknown' : 'failed',
          );
          results.set(step.id, {
            id: step.id,
            status:
              controlError.recovery === 'needsApproval'
                ? 'awaitingApproval'
                : controlError.recovery === 'needsContext' || controlError.recovery === 'refresh'
                  ? 'needsContext'
                  : controlError.dispatchState === 'unknown'
                    ? 'unknown'
                    : 'failed',
            postcondition: 'notChecked',
          });
        }

        if (firstError) {
          for (const step of pending.values()) {
            results.set(step.id, { id: step.id, status: 'skipped', postcondition: 'notChecked' });
          }
          const failedStep = results.get(firstError.stepId ?? '');
          const status =
            failedStep?.status === 'awaitingApproval'
              ? 'awaitingApproval'
              : failedStep?.status === 'needsContext'
                ? 'needsContext'
                : results.size > 1
                  ? 'partial'
                  : 'failed';
          return this.finish(owner, {
            planId,
            status,
            steps: plan.steps.map((step) => results.get(step.id)!).filter(Boolean),
            error: firstError,
            ...(status === 'awaitingApproval'
              ? {
                  checkpoint: {
                    reason: 'needsApproval' as const,
                    nextAction:
                      'Approve the pending step, then submit a fresh plan against current state.',
                  },
                }
              : status === 'needsContext'
                ? {
                    checkpoint: {
                      reason: 'needsContext' as const,
                      nextAction: 'Refresh the affected surface before continuing.',
                    },
                  }
                : {}),
          });
        }
      }

      const observation = this.output(owner, plan);
      return this.finish(owner, {
        planId,
        status: 'completed',
        steps: plan.steps.map((step) => results.get(step.id)!).filter(Boolean),
        ...(observation ? { observation } : {}),
      });
    } catch (error) {
      return this.finish(owner, {
        planId,
        status: 'failed',
        steps: plan.steps.map((step) => results.get(step.id)!).filter(Boolean),
        error: asControlError(error),
      });
    }
  }

  private async executeStep(
    owner: string,
    planId: string,
    step: ControlStep,
    adapter: ControlAdapter,
  ): Promise<ControlPlanStepResult> {
    if (this.journal.isCancelled(owner, planId)) {
      return { id: step.id, status: 'cancelled', postcondition: 'notChecked' };
    }

    let before = this.observations.get(owner, step.surfaceId);
    if (!before) {
      before = await adapter.observe();
      this.observations.record(owner, before);
    }
    const node = resolveControlTarget(before, step.target);
    for (const predicate of step.preconditions) {
      if (!evaluateControlPredicate(before, predicate, node)) {
        throw new ControlAdapterError(
          'CONTROL_PRECONDITION_FAILED',
          `Precondition ${predicate.kind} did not match for step ${step.id}`,
          'notDispatched',
          'needsContext',
        );
      }
    }

    if (!supportsControlAction(node, step.action) && step.action.op !== 'wait_for') {
      throw new ControlAdapterError(
        'CONTROL_ACTION_UNSUPPORTED',
        `Target ${node.ref} does not advertise ${step.action.op}`,
      );
    }

    if (step.action.op === 'setToggleState' && node.toggleState === step.action.state) {
      if (!evaluateControlPredicate(before, step.postcondition, node)) {
        throw new ControlAdapterError(
          'CONTROL_POSTCONDITION_FAILED',
          'Desired toggle state was already satisfied but the declared postcondition did not match',
          'notDispatched',
          'needsContext',
        );
      }
      return { id: step.id, status: 'succeeded', postcondition: 'matched' };
    }

    const resolvedTarget: ControlTarget = { ref: node.ref };
    this.journal.recordStep(
      owner,
      planId,
      step.id,
      step.action.op,
      'notDispatched',
      'dispatchRecorded',
    );
    const receipt = await adapter.dispatch(resolvedTarget, step.action, step.timeoutMs);
    this.journal.recordStep(
      owner,
      planId,
      step.id,
      step.action.op,
      receipt.dispatched ? 'dispatched' : 'notDispatched',
      'verifying',
    );
    if (this.journal.isCancelled(owner, planId) && !receipt.dispatched) {
      return { id: step.id, status: 'cancelled', postcondition: 'notChecked' };
    }

    const deadline = Date.now() + step.timeoutMs;
    while (true) {
      const after = await adapter.observe();
      this.observations.record(owner, after);
      const refreshedTarget = this.tryResolve(after, step.target);
      if (evaluateControlPredicate(after, step.postcondition, refreshedTarget)) {
        return { id: step.id, status: 'succeeded', postcondition: 'matched' };
      }
      if (Date.now() >= deadline) {
        throw new ControlAdapterError(
          'CONTROL_POSTCONDITION_FAILED',
          `Postcondition ${step.postcondition.kind} did not match after dispatch`,
          receipt.dispatched ? 'dispatched' : 'notDispatched',
          receipt.dispatched ? 'inspectOutcome' : 'needsContext',
        );
      }
      await sleep(Math.min(100, Math.max(20, deadline - Date.now())));
      before = after;
    }
  }

  private tryResolve(observation: ControlObservation, target: ControlTarget) {
    try {
      return resolveControlTarget(observation, target);
    } catch {
      return undefined;
    }
  }

  private output(owner: string, plan: ControlPlan) {
    const surfaceId = plan.surfaceIds[0];
    if (!surfaceId) return undefined;
    const latest = this.observations.get(owner, surfaceId);
    if (!latest) return undefined;
    if (plan.output.kind === 'full') {
      return {
        kind: 'full' as const,
        observation: latest,
        complete: true,
        appliedObservationId: latest.observationId,
      };
    }
    return this.observations.delta(owner, surfaceId, plan.output.baseObservationId!, {
      maxNodes: nodeBudget(plan.output.maxOutputTokens),
    });
  }

  private fail(
    owner: string,
    planId: string,
    plan: ControlPlan,
    results: Map<string, ControlPlanStepResult>,
    step: ControlStep | undefined,
    error: ControlError,
  ): ControlPlanResult {
    if (step) results.set(step.id, { id: step.id, status: 'failed', postcondition: 'notChecked' });
    return this.finish(owner, {
      planId,
      status: results.size > 1 ? 'partial' : 'failed',
      steps: plan.steps.map((candidate) => results.get(candidate.id)!).filter(Boolean),
      error,
    });
  }

  private finish(owner: string, result: ControlPlanResult): ControlPlanResult {
    this.journal.finish(owner, result);
    return result;
  }
}
