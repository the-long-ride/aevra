import assert from 'node:assert/strict';
import test from 'node:test';
import { handleControlTool } from '../src/control-tools.js';
import { controlContext, plan } from './control-context.js';

const code = (expected: string, pattern?: RegExp) => (error: any) =>
  error?.code === expected && (!pattern || pattern.test(error.message));

test('desktop_act_many validates actions and window before any provider call', async () => {
  const ctx = controlContext();
  const run = (args: any) => handleControlTool(ctx.value, 's1', 'desktop_act_many', args);
  await assert.rejects(run({ windowId: 'w1' }), code('INVALID_REQUEST', /at least one action/));
  await assert.rejects(run({ windowId: 'w1', actions: [] }), code('INVALID_REQUEST'));
  await assert.rejects(
    run({ actions: [{ op: 'click', ref: 'd1' }] }),
    code('INVALID_REQUEST', /windowId/),
  );
  await assert.rejects(
    run({ windowId: 'w1', actions: [{ op: 'hover', ref: 'd1' }] }),
    code('INVALID_REQUEST', /Unsupported desktop batch action: hover/),
  );
  await assert.rejects(
    run({ windowId: 'w1', actions: [null] }),
    code('INVALID_REQUEST', /undefined/),
  );
  assert.equal(ctx.calls.length, 0);
});

test('desktop_act_many requires a ref or a complete locator for each step', async () => {
  for (const bad of [
    { op: 'click' },
    { op: 'click', ref: '' },
    { op: 'click', locator: { role: 'button' } },
    { op: 'click', locator: { name: 'Save' } },
  ]) {
    const ctx = controlContext();
    await assert.rejects(
      handleControlTool(ctx.value, 's1', 'desktop_act_many', { windowId: 'w1', actions: [bad] }),
      code('INVALID_REQUEST', /requires ref or locator/),
    );
    assert.deepEqual(
      ctx.calls.map((c) => c.tool),
      ['desktop_describe'],
      'only the baseline observation runs before the step is rejected',
    );
  }
});

test('desktop_act_many chains steps and derives postconditions from each action', async () => {
  const ctx = controlContext();
  const result: any = await handleControlTool(ctx.value, 's1', 'desktop_act_many', {
    windowId: 'w1',
    requestId: 'batch-1',
    actions: [
      { op: 'setValue', ref: 'd2', value: 'new words' },
      { id: 'tog', op: 'setToggleState', ref: 'd3', state: 'on' },
      { op: 'invoke', locator: { role: 'button', name: 'Save' } },
    ],
  });
  assert.equal(result.status, 'completed');
  assert.deepEqual(
    result.steps.map((s: any) => [s.id, s.status, s.postcondition]),
    [
      ['step_1', 'succeeded', 'matched'],
      ['tog', 'succeeded', 'matched'],
      ['step_3', 'succeeded', 'matched'],
    ],
  );
  const tools = ctx.calls.map((c) => c.tool).filter((t) => t !== 'desktop_describe');
  assert.deepEqual(tools, ['desktop_set_value', 'desktop_toggle', 'desktop_invoke']);
  assert.equal(ctx.calls.find((c) => c.tool === 'desktop_invoke')?.args.ref, 'd1');
  assert.equal(ctx.desktop.nodes[1].value, 'new words');
  assert.equal(ctx.desktop.nodes[2].toggleState, 'on');

  const status: any = await handleControlTool(ctx.value, 's1', 'control_plan_status', {
    planId: result.planId,
  });
  assert.equal(status.planId, result.planId);
  assert.equal(status.requestId, 'batch-1');
  assert.equal(status.status, 'completed');
  assert.equal(status.cancelled, false);
  assert.equal(status.result.untrusted, true);
});

test('desktop_act_many maps type, select, click and off toggles with explicit conditions', async () => {
  const ctx = controlContext();
  const result: any = await handleControlTool(ctx.value, 's1', 'desktop_act_many', {
    windowId: 'w1',
    stopOnError: false,
    deadlineMs: 500,
    maxOutputTokens: 5,
    actions: [
      { op: 'type', ref: 'd2', text: 'typed', clear: false },
      {
        op: 'select',
        locator: { role: 'edit', name: 'Title', scope: 'subtree', observedAncestor: 'd1' },
        preconditions: [],
        postcondition: { kind: 'enabled', equals: true },
        timeoutMs: 1,
      },
      { op: 'click', ref: 'd1' },
      { op: 'setToggleState', ref: 'd3', state: 'off' },
    ],
  });
  assert.equal(result.status, 'needsContext');
  assert.equal(result.steps[0].status, 'succeeded');
  assert.equal(result.error.code, 'CONTROL_TARGET_NOT_FOUND');
  assert.equal(result.error.stepId, 'step_2', 'subtree locator is scoped to the observed ancestor');
  assert.equal(ctx.calls.find((c) => c.tool === 'desktop_set_value')?.args.value, 'typed');
});

test('control plan status and cancel require a plan id that exists for the owner', async () => {
  const ctx = controlContext();
  for (const name of ['control_plan_status', 'control_plan_cancel']) {
    await assert.rejects(
      handleControlTool(ctx.value, 's1', name, {}),
      code('INVALID_REQUEST', new RegExp(`${name} requires planId`)),
    );
    await assert.rejects(
      handleControlTool(ctx.value, 's1', name, { planId: 'plan-missing' }),
      code('NOT_FOUND'),
    );
  }
  const failed: any = await handleControlTool(ctx.value, 's1', 'control_execute', {
    plan: plan('browser:never-seen', 'obs_1'),
  });
  const other: any = await handleControlTool(ctx.value, 's2', 'control_plan_status', {
    planId: failed.planId,
  }).catch((e) => e);
  assert.equal(other.code, 'NOT_FOUND', 'plans are private to their owner');
});

test('control_execute rejects plans naming unknown surface kinds', async () => {
  const ctx = controlContext();
  await assert.rejects(
    handleControlTool(ctx.value, 's1', 'control_execute', { plan: plan('window:x', 'obs') }),
    code('INVALID_REQUEST', /Unknown control surface window:x/),
  );
});

test('control tools fail closed without a connection identity', async () => {
  const ctx = controlContext();
  ctx.value.deps.hostControlAccess.identity = () => undefined;
  await assert.rejects(
    handleControlTool(ctx.value, 's1', 'control_plan_status', { planId: 'p' }),
    code('UNAUTHORIZED'),
  );
  await assert.rejects(
    handleControlTool(ctx.value, 's1', 'control_observe', { windowId: 'w1' }),
    code('UNAUTHORIZED'),
  );
});

test('ungranted host control returns the local approval request instead of acting', async () => {
  const ctx = controlContext();
  const requested: any[] = [];
  ctx.value.deps.hostControlAccess.has = () => false;
  ctx.value.deps.hostControlApproval = {
    requestHostControl: async (sessionId: string, capability: string, payload: any) => {
      requested.push([sessionId, capability, payload.tool]);
      return { status: 'approval_pending', requestId: `r${requested.length}` };
    },
  };
  const observed: any = await handleControlTool(ctx.value, 's1', 'control_observe', {
    kind: 'browser',
  });
  assert.deepEqual(observed, {
    status: 'approval_pending',
    requestId: 'r1',
    requiredCapability: 'browser.control',
    scope: 'host-control',
  });
  const executed: any = await handleControlTool(ctx.value, 's1', 'control_execute', {
    plan: plan('desktop:w1', 'obs_1'),
  });
  assert.equal(executed.requiredCapability, 'desktop.control');
  const batch: any = await handleControlTool(ctx.value, 's1', 'desktop_act_many', {
    windowId: 'w1',
    actions: [{ op: 'click', ref: 'd1' }],
  });
  assert.equal(batch.requestId, 'r3');
  assert.deepEqual(requested, [
    ['s1', 'browser.control', 'control_observe'],
    ['s1', 'desktop.control', 'control_execute'],
    ['s1', 'desktop.control', 'desktop_act_many'],
  ]);
  assert.equal(ctx.calls.length, 0);
});
