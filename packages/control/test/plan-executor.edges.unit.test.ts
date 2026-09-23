import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ControlAction,
  ControlCapabilities,
  ControlMode,
  ControlNode,
  ControlObservation,
  ControlPlan,
  ControlStep,
  ControlTarget,
} from '../../protocol/src/control.js';
import {
  ControlAdapterError,
  type ControlAdapter,
  type ControlDispatchReceipt,
} from '../src/adapter.js';
import { PlanExecutor } from '../src/plan-executor.js';

type DispatchScript = (action: ControlAction) => Promise<ControlDispatchReceipt>;

/** Adapter whose node and dispatch behavior each test scripts. */
class ScriptedAdapter implements ControlAdapter {
  observeCalls = 0;
  dispatchCalls = 0;
  private revision = 1;
  node: ControlNode = {
    ref: 'name',
    role: 'textbox',
    name: 'Display name',
    value: 'before',
    enabled: true,
    actions: ['setValue', 'setToggleState'],
  };

  constructor(
    private readonly onDispatch: DispatchScript = async () => ({
      dispatched: true,
      outcome: 'completed',
    }),
    readonly mode: ControlMode = 'sharedSemantic',
    readonly surfaceId = 'desktop:w1',
  ) {}

  capabilities(): ControlCapabilities {
    return {
      semantic: true,
      isolation: 'shared',
      capture: false,
      watch: false,
      attribution: true,
      actions: ['setValue'],
      limitations: [],
    };
  }

  observation(id = `obs_${this.revision}`): ControlObservation {
    const now = '2026-09-23T00:00:00.000Z';
    return {
      observationId: id,
      surfaceId: this.surfaceId,
      generation: 1,
      revision: this.revision,
      freshness: 'fresh',
      watchHealth: 'healthy',
      observedAt: now,
      lastValidatedAt: now,
      policyRevision: 1,
      mode: this.mode,
      coverage: { scope: 'surface', truncated: false, omittedNodes: 0 },
      nodes: [structuredClone(this.node)],
    };
  }

  async observe(): Promise<ControlObservation> {
    this.observeCalls++;
    this.revision++;
    return this.observation();
  }

  async dispatch(
    _target: ControlTarget,
    action: ControlAction,
    _timeoutMs: number,
  ): Promise<ControlDispatchReceipt> {
    this.dispatchCalls++;
    return this.onDispatch(action);
  }
}

function step(overrides: Partial<ControlStep> = {}): ControlStep {
  return {
    id: 'a',
    surfaceId: 'desktop:w1',
    dependsOn: [],
    target: { ref: 'name' },
    action: { op: 'setValue', value: 'after' },
    preconditions: [],
    postcondition: { kind: 'valueEquals', value: 'after' },
    timeoutMs: 1_000,
    ...overrides,
  };
}

function plan(steps: ControlStep[], overrides: Partial<ControlPlan> = {}): ControlPlan {
  return {
    schemaVersion: 1,
    requestId: `req_${Math.random().toString(36).slice(2)}`,
    surfaceIds: ['desktop:w1'],
    expectedObservations: { 'desktop:w1': 'obs_base' },
    mode: 'sharedSemantic',
    deadlineMs: 5_000,
    maxConcurrency: 1,
    steps,
    output: { kind: 'full', maxOutputTokens: 1_000 },
    ...overrides,
  };
}

async function run(adapter: ScriptedAdapter, request: ControlPlan, executor = new PlanExecutor()) {
  executor.observations.record('owner', adapter.observation('obs_base'));
  return executor.execute('owner', request, new Map([[adapter.surfaceId, adapter]]));
}

function failWith(error: unknown): DispatchScript {
  return async () => {
    throw error;
  };
}

test('a plan naming an unobserved surface asks for context before dispatch', async () => {
  const executor = new PlanExecutor();
  const result = await executor.execute('owner', plan([step()]), new Map());
  assert.equal(result.status, 'needsContext');
  assert.equal(result.error?.code, 'CONTROL_SURFACE_NOT_FOUND');
});

test('a surface bound to another mode is refused', async () => {
  const adapter = new ScriptedAdapter(undefined, 'isolated');
  const result = await run(adapter, plan([step()]));
  assert.equal(result.error?.code, 'CONTROL_MODE_MISMATCH');
  assert.equal(adapter.dispatchCalls, 0);
});

test('an approval-gated dispatch pauses the plan with an approval checkpoint', async () => {
  const adapter = new ScriptedAdapter(
    failWith(
      new ControlAdapterError(
        'CONTROL_APPROVAL_REQUIRED',
        'wait',
        'notDispatched',
        'needsApproval',
      ),
    ),
  );
  const result = await run(adapter, plan([step(), step({ id: 'b', dependsOn: ['a'] })]));
  assert.equal(result.status, 'awaitingApproval');
  assert.equal(result.checkpoint?.reason, 'needsApproval');
  assert.deepEqual(
    result.steps.map((candidate) => candidate.status),
    ['awaitingApproval', 'skipped'],
  );
});

test('a refresh-recoverable failure asks for context', async () => {
  const adapter = new ScriptedAdapter(
    failWith(new ControlAdapterError('CONTROL_REF_STALE', 'gone', 'notDispatched', 'refresh')),
  );
  const result = await run(adapter, plan([step()]));
  assert.equal(result.status, 'needsContext');
  assert.equal(result.checkpoint?.reason, 'needsContext');
});

test('an unknown dispatch outcome is reported as unknown, not failed', async () => {
  const adapter = new ScriptedAdapter(
    failWith(
      new ControlAdapterError('CONTROL_OUTCOME_UNKNOWN', 'lost', 'unknown', 'inspectOutcome'),
    ),
  );
  const result = await run(adapter, plan([step()]));
  assert.equal(result.status, 'failed');
  assert.equal(result.steps[0]?.status, 'unknown');
  assert.equal(result.error?.dispatchState, 'unknown');
});

test('a failure with siblings already settled makes the plan partial', async () => {
  let calls = 0;
  const adapter = new ScriptedAdapter(async (action) => {
    calls++;
    if (calls === 2) throw Object.assign(new Error('driver crashed'), { code: 'EDRIVER' });
    adapter.node = { ...adapter.node, value: (action as { value: string }).value };
    return { dispatched: true, outcome: 'completed' };
  });
  const result = await run(
    adapter,
    plan([step(), step({ id: 'b', dependsOn: ['a'], action: { op: 'setValue', value: 'b' } })]),
  );
  assert.equal(result.status, 'partial');
  assert.equal(result.error?.code, 'EDRIVER');
  assert.deepEqual(
    result.steps.map((candidate) => candidate.status),
    ['succeeded', 'failed'],
  );
});

test('a failed precondition stops the step before dispatch', async () => {
  const adapter = new ScriptedAdapter();
  const result = await run(
    adapter,
    plan([step({ preconditions: [{ kind: 'enabled', equals: false }] })]),
  );
  assert.equal(result.status, 'needsContext');
  assert.equal(result.error?.code, 'CONTROL_PRECONDITION_FAILED');
  assert.equal(adapter.dispatchCalls, 0);
});

test('an action the target does not advertise is refused', async () => {
  const adapter = new ScriptedAdapter();
  const result = await run(adapter, plan([step({ action: { op: 'select', value: 'x' } })]));
  assert.equal(result.status, 'failed');
  assert.equal(result.error?.code, 'CONTROL_ACTION_UNSUPPORTED');
  assert.equal(adapter.dispatchCalls, 0);
});

test('an already-satisfied toggle succeeds without dispatching', async () => {
  const adapter = new ScriptedAdapter();
  adapter.node = { ...adapter.node, toggleState: 'on' };
  const toggle = step({
    action: { op: 'setToggleState', state: 'on' },
    postcondition: { kind: 'toggleStateEquals', state: 'on' },
  });
  const result = await run(adapter, plan([toggle]));
  assert.equal(result.status, 'completed');
  assert.equal(adapter.dispatchCalls, 0);

  const mismatch = await run(
    adapter,
    plan([{ ...toggle, postcondition: { kind: 'valueEquals', value: 'other' } }]),
  );
  assert.equal(mismatch.status, 'needsContext');
  assert.equal(mismatch.error?.code, 'CONTROL_POSTCONDITION_FAILED');
});

test('wait_for skips the advertised-action check and accepts an undispatched receipt', async () => {
  const adapter = new ScriptedAdapter(async () => ({
    dispatched: false,
    outcome: 'alreadySatisfied',
  }));
  const result = await run(
    adapter,
    plan([
      step({
        action: { op: 'wait_for', timeoutMs: 100 },
        postcondition: { kind: 'enabled', equals: true },
      }),
    ]),
  );
  assert.equal(result.status, 'completed');
  assert.equal(adapter.dispatchCalls, 1);
});

test('a postcondition that never matches fails once the step times out', async () => {
  const adapter = new ScriptedAdapter();
  const result = await run(adapter, plan([step({ timeoutMs: 60 })]));
  assert.equal(result.status, 'failed');
  assert.equal(result.error?.code, 'CONTROL_POSTCONDITION_FAILED');
  assert.equal(result.error?.recovery, 'inspectOutcome');
  assert.ok(adapter.observeCalls >= 2, 'the executor re-observes while it waits');
});

test('an undispatched step whose postcondition never matches asks for context', async () => {
  const adapter = new ScriptedAdapter(async () => ({
    dispatched: false,
    outcome: 'alreadySatisfied',
  }));
  const result = await run(adapter, plan([step({ timeoutMs: 30 })]));
  assert.equal(result.status, 'needsContext');
  assert.equal(result.error?.dispatchState, 'notDispatched');
});

test('the plan deadline stops the next wave', async () => {
  const adapter = new ScriptedAdapter(async (action) => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    adapter.node = { ...adapter.node, value: (action as { value: string }).value };
    return { dispatched: true, outcome: 'completed' };
  });
  const result = await run(
    adapter,
    plan([step(), step({ id: 'b', dependsOn: ['a'] })], { deadlineMs: 30 }),
  );
  assert.equal(result.error?.code, 'CONTROL_DEADLINE_EXCEEDED');
  assert.equal(result.error?.stepId, 'b');
  assert.equal(result.status, 'partial');
});

test('a dependency cycle is reported instead of spinning', async () => {
  const adapter = new ScriptedAdapter();
  const result = await run(
    adapter,
    plan([step({ dependsOn: ['b'] }), step({ id: 'b', dependsOn: ['a'] })]),
  );
  assert.equal(result.status, 'failed');
  assert.equal(result.error?.code, 'CONTROL_DEPENDENCY_DEADLOCK');
});

test('a request id still running cannot be claimed twice', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const adapter = new ScriptedAdapter(async (action) => {
    await gate;
    adapter.node = { ...adapter.node, value: (action as { value: string }).value };
    return { dispatched: true, outcome: 'completed' };
  });
  const executor = new PlanExecutor();
  const request = plan([step()]);
  const first = run(adapter, request, executor);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await assert.rejects(
    executor.execute('owner', request, new Map([[adapter.surfaceId, adapter]])),
    /CONTROL_PLAN_RUNNING/,
  );
  release();
  assert.equal((await first).status, 'completed');
});

test('status and cancel reach the journal by owner and plan id', async () => {
  const adapter = new ScriptedAdapter(async (action) => {
    adapter.node = { ...adapter.node, value: (action as { value: string }).value };
    return { dispatched: true, outcome: 'completed' };
  });
  const executor = new PlanExecutor();
  const result = await run(adapter, plan([step()]), executor);
  assert.equal(executor.status('owner', result.planId)?.status, 'completed');
  assert.equal(executor.status('someone-else', result.planId), undefined);
  assert.equal(executor.cancel('someone-else', result.planId), false);
});
