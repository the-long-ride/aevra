import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { handleControlTool } from '../src/control-tools.js';
import { controlContext, plan } from './control-context.js';

const code = (expected: string) => (error: any) => error?.code === expected;
const outbound = createHash('sha256').update('control-branch-fixture-phrase').digest('hex');

test('control tools reject names outside the control tool set', async () => {
  const ctx = controlContext();
  await assert.rejects(
    handleControlTool(ctx.value, 's1', 'control_unknown', {}),
    code('CAPABILITY_REQUIRED'),
  );
});

test('desktop observation requires a window id', async () => {
  const ctx = controlContext();
  await assert.rejects(
    handleControlTool(ctx.value, 's1', 'control_observe', {}),
    (error: any) => error.code === 'INVALID_REQUEST' && /windowId/.test(error.message),
  );
  assert.equal(ctx.calls.length, 0);
});

test('isolated observation is refused because no isolated runner exists', async () => {
  const ctx = controlContext();
  await assert.rejects(
    handleControlTool(ctx.value, 's1', 'control_observe', { windowId: 'w1', mode: 'isolated' }),
    code('CONTROL_ISOLATION_UNAVAILABLE'),
  );
});

test('desktop observation projects interactive nodes and reports image delivery limits', async () => {
  const ctx = controlContext();
  const result: any = await handleControlTool(ctx.value, 's1', 'control_observe', {
    windowId: 'w1',
    maxOutputTokens: 'not a number',
    includeImage: true,
  });
  assert.equal(result.untrusted, true);
  assert.equal(result.includeImage, false);
  assert.match(result.imageNotice, /not embedded/);
  assert.equal(result.capabilities.capture, false);
  assert.equal(result.observation.surfaceId, 'desktop:w1');
  assert.equal(ctx.calls[0]?.tool, 'desktop_describe');

  const full: any = await handleControlTool(ctx.value, 's1', 'control_observe', {
    windowId: 'w1',
    detail: 'full',
    maxOutputTokens: 12,
  });
  assert.equal('imageNotice' in full, false);
  assert.ok(full.observation);
});

test('browser observation targets the requested tab or the active one', async () => {
  const ctx = controlContext();
  const pinned: any = await handleControlTool(ctx.value, 's1', 'control_observe', {
    kind: 'browser',
    tabId: 't1',
    maxOutputTokens: 1_000_000,
  });
  assert.equal(pinned.observation.surfaceId, 'browser:t1');
  assert.equal(pinned.capabilities.capture, true);
  assert.equal(ctx.calls[0]?.args.tabId, 't1');

  const active: any = await handleControlTool(ctx.value, 's1', 'control_observe', {
    kind: 'browser',
  });
  assert.equal(active.observation.surfaceId, 'browser:t1');
  assert.equal('tabId' in ctx.calls[1]!.args, false);
});

test('control_execute runs a plan on an observed surface and audits success', async () => {
  const ctx = controlContext();
  const observed: any = await handleControlTool(ctx.value, 's1', 'control_observe', {
    kind: 'browser',
    tabId: 't1',
  });
  const surfaceId = observed.observation.surfaceId;
  const result: any = await handleControlTool(ctx.value, 's1', 'control_execute', {
    plan: plan(surfaceId, observed.observation.observationId),
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.untrusted, true);
  assert.ok(ctx.calls.some((call) => call.tool === 'browser_act_many'));
  const entry = ctx.audit.events.find((e: any) => e.tool === 'control_execute');
  assert.equal(entry?.result, 'SUCCEEDED');
  assert.equal(entry?.target, surfaceId);
  assert.equal(entry?.workspaceId, ctx.workspaceId);
});

test('control_execute against a surface never observed fails and audits the failure', async () => {
  const ctx = controlContext();
  const result: any = await handleControlTool(ctx.value, 's1', 'control_execute', {
    plan: plan('browser:never-seen', 'obs_missing'),
  });
  assert.notEqual(result.status, 'completed');
  assert.equal(ctx.calls.length, 0);
  const entry = ctx.audit.events.find((e: any) => e.tool === 'control_execute');
  assert.equal(entry?.result, 'FAILED');
});

test('control_execute works when no audit sink is configured', async () => {
  const ctx = controlContext({ audit: false });
  const result: any = await handleControlTool(ctx.value, 's1', 'control_execute', {
    plan: plan('browser:never-seen', 'obs_missing'),
  });
  assert.ok(result.planId);
  assert.equal(ctx.audit.events.length, 0);
});

test('secret-shaped setValue and select plan data is refused before dispatch', async () => {
  const ctx = controlContext();
  for (const action of [
    { op: 'setValue', value: outbound },
    { op: 'select', value: outbound },
  ]) {
    await assert.rejects(
      handleControlTool(ctx.value, 's1', 'control_execute', {
        plan: plan('browser:t1', 'obs_1', { action }),
      }),
      (error: any) => error.code === 'INVALID_REQUEST' && error.message.includes(action.op),
    );
  }
  assert.equal(ctx.calls.length, 0);
});

test('empty and ordinary text values pass the secret-data screen', async () => {
  const ctx = controlContext();
  for (const action of [
    { op: 'type', text: '' },
    { op: 'setValue', value: 'plain words' },
    { op: 'press_key', key: 'Enter' },
  ]) {
    const result: any = await handleControlTool(ctx.value, 's1', 'control_execute', {
      plan: plan('browser:never-seen', 'obs_1', { action }),
    });
    assert.ok(result.planId);
  }
});

test('surfaces are shared by sessions on the same connection and workspace', async () => {
  const ctx = controlContext({ connectionId: `conn-${Math.random()}` });
  const observed: any = await handleControlTool(ctx.value, 's1', 'control_observe', {
    kind: 'browser',
    tabId: 't1',
  });
  const result: any = await handleControlTool(ctx.value, 's2', 'control_execute', {
    plan: plan(observed.observation.surfaceId, observed.observation.observationId),
  });
  assert.equal(result.status, 'completed');
  assert.equal(ctx.calls.at(-1)?.sessionId, 's2');
});

test('a connection identity without an id falls back to per-session ownership', async () => {
  const ctx = controlContext({ identity: () => ({}) });
  const observed: any = await handleControlTool(ctx.value, 'solo-a', 'control_observe', {
    kind: 'browser',
    tabId: 't1',
  });
  const result: any = await handleControlTool(ctx.value, 'solo-b', 'control_execute', {
    plan: plan(observed.observation.surfaceId, observed.observation.observationId),
  });
  assert.notEqual(result.status, 'completed');
  assert.equal(
    ctx.calls.some((call) => call.tool === 'browser_act_many'),
    false,
  );
});
