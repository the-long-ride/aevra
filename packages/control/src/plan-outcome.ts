// Pure decisions the plan executor makes about blocked plans and failed steps.
import type {
  ControlError,
  ControlObservation,
  ControlPlan,
  ControlPlanResult,
  ControlPlanStepResult,
} from '../../protocol/src/control.js';
import { ControlAdapterError, type ControlAdapter } from './adapter.js';

export type PlanOutcome = Omit<ControlPlanResult, 'planId'>;

export function asControlError(error: unknown, stepId?: string): ControlError {
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

export function nodeBudget(maxOutputTokens: number): number {
  return Math.max(1, Math.min(500, Math.floor(maxOutputTokens / 12)));
}

/** Why a plan cannot start: a missing adapter, a mode mismatch, or a stale observation. */
export function preflightFailure(
  plan: ControlPlan,
  adapters: Map<string, ControlAdapter>,
  currentObservation: (surfaceId: string) => ControlObservation | undefined,
): PlanOutcome | undefined {
  for (const surfaceId of plan.surfaceIds) {
    const adapter = adapters.get(surfaceId);
    if (!adapter) {
      return {
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
      };
    }
    if (adapter.mode !== plan.mode) {
      return {
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
      };
    }
    const current = currentObservation(surfaceId);
    if (!current || current.observationId !== plan.expectedObservations[surfaceId]) {
      return {
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
      };
    }
  }
  return undefined;
}

export function failedStepStatus(error: ControlError): ControlPlanStepResult['status'] {
  if (error.recovery === 'needsApproval') return 'awaitingApproval';
  if (error.recovery === 'needsContext' || error.recovery === 'refresh') return 'needsContext';
  return error.dispatchState === 'unknown' ? 'unknown' : 'failed';
}

/** Plan status and checkpoint once a step in the current wave has failed. */
export function failedPlanOutcome(
  failedStep: ControlPlanStepResult | undefined,
  resultCount: number,
): Pick<ControlPlanResult, 'status' | 'checkpoint'> {
  if (failedStep?.status === 'awaitingApproval') {
    return {
      status: 'awaitingApproval',
      checkpoint: {
        reason: 'needsApproval',
        nextAction: 'Approve the pending step, then submit a fresh plan against current state.',
      },
    };
  }
  if (failedStep?.status === 'needsContext') {
    return {
      status: 'needsContext',
      checkpoint: {
        reason: 'needsContext',
        nextAction: 'Refresh the affected surface before continuing.',
      },
    };
  }
  return { status: resultCount > 1 ? 'partial' : 'failed' };
}
