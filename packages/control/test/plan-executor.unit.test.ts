import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ControlAction,
  ControlCapabilities,
  ControlObservation,
  ControlPlan,
  ControlTarget,
} from '../../protocol/src/control.js';
import type { ControlAdapter, ControlDispatchReceipt } from '../src/adapter.js';
import { PlanExecutor } from '../src/plan-executor.js';
import { ControlPlanJournal, type ControlPlanPersistence } from '../src/plan-journal.js';

class FakeAdapter implements ControlAdapter {
  readonly mode = 'sharedSemantic' as const;
  value = 'before';
  observeCalls = 0;
  dispatchCalls = 0;
  revision = 1;

  constructor(
    readonly surfaceId = 'desktop:w1',
    private readonly concurrency?: { active: number; max: number },
  ) {}

  capabilities(): ControlCapabilities {
    return {
      semantic: true,
      isolation: 'shared',
      capture: false,
      watch: true,
      attribution: true,
      actions: ['setValue'],
      limitations: [],
    };
  }

  observation(id = `obs_${this.revision}`): ControlObservation {
    const now = '2026-09-22T00:00:00.000Z';
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
      nodes: [
        {
          ref: 'name',
          role: 'textbox',
          name: 'Display name',
          value: this.value,
          enabled: true,
          actions: ['setValue'],
        },
      ],
    };
  }

  async observe(): Promise<ControlObservation> {
    this.observeCalls++;
    return this.observation();
  }

  async dispatch(
    _target: ControlTarget,
    action: ControlAction,
    _timeoutMs: number,
  ): Promise<ControlDispatchReceipt> {
    this.dispatchCalls++;
    if (action.op !== 'setValue') throw new Error('unexpected action');
    if (this.concurrency) {
      this.concurrency.active++;
      this.concurrency.max = Math.max(this.concurrency.max, this.concurrency.active);
      await new Promise((resolve) => setTimeout(resolve, 30));
      this.concurrency.active--;
    }
    this.value = action.value;
    this.revision++;
    return { dispatched: true, outcome: 'completed' };
  }
}

function plan(base: ControlObservation): ControlPlan {
  return {
    schemaVersion: 1,
    requestId: 'req_1',
    surfaceIds: [base.surfaceId],
    expectedObservations: { [base.surfaceId]: base.observationId },
    mode: 'sharedSemantic',
    deadlineMs: 5000,
    maxConcurrency: 1,
    steps: [
      {
        id: 'name',
        surfaceId: base.surfaceId,
        dependsOn: [],
        target: { ref: 'name' },
        action: { op: 'setValue', value: 'after' },
        preconditions: [{ kind: 'enabled', equals: true }],
        postcondition: { kind: 'valueEquals', value: 'after' },
        timeoutMs: 1000,
      },
    ],
    output: { kind: 'delta', baseObservationId: base.observationId, maxOutputTokens: 1000 },
  };
}

test('uses the expected observation for dispatch and verifies the postcondition locally', async () => {
  const executor = new PlanExecutor();
  const adapter = new FakeAdapter();
  const base = adapter.observation('obs_base');
  executor.observations.record('owner', base);

  const result = await executor.execute(
    'owner',
    plan(base),
    new Map([[adapter.surfaceId, adapter]]),
  );

  assert.equal(result.status, 'completed');
  assert.equal(result.steps[0]?.status, 'succeeded');
  assert.equal(adapter.dispatchCalls, 1);
  assert.equal(adapter.observeCalls, 1, 'only the post-dispatch verification needs a fresh read');
  assert.equal(result.observation?.kind, 'delta');
});

test('stale expected observation checkpoints before dispatch', async () => {
  const executor = new PlanExecutor();
  const adapter = new FakeAdapter();
  const base = adapter.observation('obs_base');
  executor.observations.record('owner', base);
  adapter.revision++;
  executor.observations.record('owner', adapter.observation('obs_new'));

  const result = await executor.execute(
    'owner',
    plan(base),
    new Map([[adapter.surfaceId, adapter]]),
  );

  assert.equal(result.status, 'needsContext');
  assert.equal(adapter.dispatchCalls, 0);
  assert.equal(result.error?.recovery, 'refresh');
});

test('duplicate request id returns the completed result and never redispatches', async () => {
  const executor = new PlanExecutor();
  const adapter = new FakeAdapter();
  const base = adapter.observation('obs_base');
  executor.observations.record('owner', base);
  const request = plan(base);

  const first = await executor.execute('owner', request, new Map([[adapter.surfaceId, adapter]]));
  const second = await executor.execute('owner', request, new Map([[adapter.surfaceId, adapter]]));

  assert.equal(first.planId, second.planId);
  assert.equal(adapter.dispatchCalls, 1);
});

test('same request attaches to a recovered durable terminal result after executor restart', async () => {
  let durable: any;
  const key = Buffer.alloc(32, 7);
  const persistence: ControlPlanPersistence = {
    digestKey: () => key,
    claim(input) {
      if (durable) return { record: structuredClone(durable), existing: true };
      durable = { ...input, cancelled: false };
      return { record: structuredClone(durable), existing: false };
    },
    get(owner, planId) {
      return durable?.owner === owner && durable?.planId === planId
        ? structuredClone(durable)
        : undefined;
    },
    updateStatus(owner, planId, status, cancelled = false) {
      if (!durable || durable.owner !== owner || durable.planId !== planId) return false;
      durable.status = status;
      durable.cancelled = cancelled;
      return true;
    },
    finish(owner, planId, status, result, cancelled = false) {
      if (!durable || durable.owner !== owner || durable.planId !== planId) return false;
      durable.status = status;
      durable.cancelled = cancelled;
      durable.result = structuredClone(result);
      return true;
    },
    recordStep() {},
  };

  const adapter = new FakeAdapter();
  const base = adapter.observation('obs_base');
  const firstExecutor = new PlanExecutor(undefined, new ControlPlanJournal(persistence));
  firstExecutor.observations.record('owner', base);
  const request = plan(base);
  const first = await firstExecutor.execute(
    'owner',
    request,
    new Map([[adapter.surfaceId, adapter]]),
  );

  const secondExecutor = new PlanExecutor(undefined, new ControlPlanJournal(persistence));
  const second = await secondExecutor.execute(
    'owner',
    request,
    new Map([[adapter.surfaceId, adapter]]),
  );

  assert.equal(second.planId, first.planId);
  assert.equal(second.status, 'completed');
  assert.equal(adapter.dispatchCalls, 1);
});

test('maxConcurrency runs independent surfaces together while scheduler keeps surface ownership', async () => {
  const tracker = { active: 0, max: 0 };
  const firstAdapter = new FakeAdapter('desktop:first', tracker);
  const secondAdapter = new FakeAdapter('desktop:second', tracker);
  const first = firstAdapter.observation('obs_first');
  const second = secondAdapter.observation('obs_second');
  const executor = new PlanExecutor();
  executor.observations.record('owner', first);
  executor.observations.record('owner', second);

  const request: ControlPlan = {
    schemaVersion: 1,
    requestId: 'req_parallel',
    surfaceIds: [first.surfaceId, second.surfaceId],
    expectedObservations: {
      [first.surfaceId]: first.observationId,
      [second.surfaceId]: second.observationId,
    },
    mode: 'sharedSemantic',
    deadlineMs: 5000,
    maxConcurrency: 2,
    steps: [
      {
        id: 'first',
        surfaceId: first.surfaceId,
        dependsOn: [],
        target: { ref: 'name' },
        action: { op: 'setValue', value: 'one' },
        preconditions: [{ kind: 'enabled', equals: true }],
        postcondition: { kind: 'valueEquals', value: 'one' },
        timeoutMs: 1000,
      },
      {
        id: 'second',
        surfaceId: second.surfaceId,
        dependsOn: [],
        target: { ref: 'name' },
        action: { op: 'setValue', value: 'two' },
        preconditions: [{ kind: 'enabled', equals: true }],
        postcondition: { kind: 'valueEquals', value: 'two' },
        timeoutMs: 1000,
      },
    ],
    output: { kind: 'full', maxOutputTokens: 1000 },
  };

  const result = await executor.execute(
    'owner',
    request,
    new Map([
      [firstAdapter.surfaceId, firstAdapter],
      [secondAdapter.surfaceId, secondAdapter],
    ]),
  );

  assert.equal(result.status, 'completed');
  assert.equal(tracker.max, 2);
  assert.equal(firstAdapter.dispatchCalls, 1);
  assert.equal(secondAdapter.dispatchCalls, 1);
});
