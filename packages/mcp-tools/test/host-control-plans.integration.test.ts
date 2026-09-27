import assert from 'node:assert/strict';
import test from 'node:test';
import { handleControlTool } from '../src/control-tools.js';
import { controlContext, plan } from './control-context.js';

test('observations and plans work without a workspace and stay connection-owned', async () => {
  const ctx = controlContext();
  ctx.value.sessions.activeLease = () => null;
  ctx.value.deps.hostControlAccess = {
    identity: (id: string) => ({ kind: 'session', key: id }),
    has: () => true,
  };
  const observed: any = await handleControlTool(ctx.value, 's1', 'control_observe', {
    kind: 'browser',
    tabId: 't1',
  });
  assert.equal(observed.observation.surfaceId, 'browser:t1');
  const result: any = await handleControlTool(ctx.value, 's1', 'control_execute', {
    plan: plan(observed.observation.surfaceId, observed.observation.observationId),
  });
  assert.equal(result.status, 'completed');
  const status: any = await handleControlTool(ctx.value, 's1', 'control_plan_status', {
    planId: result.planId,
  });
  assert.equal(status.planId, result.planId);
  await assert.rejects(
    () => handleControlTool(ctx.value, 's2', 'control_plan_status', { planId: result.planId }),
    /not found/,
  );
});

test('revocation stops queued browser dispatch and original owner can inspect plan', async () => {
  let browserGranted = true;
  const ctx = controlContext({
    reply: (tool) => {
      if (tool === 'browser_act_many') browserGranted = false;
      return undefined;
    },
  });
  ctx.value.sessions.activeLease = () => null;
  ctx.value.deps.hostControlAccess = {
    identity: (id: string) => ({ kind: 'session', key: id }),
    has: (_id: string, capability: string) =>
      capability === 'browser.control' ? browserGranted : false,
  };
  const observed: any = await handleControlTool(ctx.value, 's1', 'control_observe', {
    kind: 'browser',
    tabId: 't1',
  });
  const surfaceId = observed.observation.surfaceId;
  const first = plan(surfaceId, observed.observation.observationId);
  first.steps.push({ ...first.steps[0], id: 's2', dependsOn: ['s1'] });
  const result: any = await handleControlTool(ctx.value, 's1', 'control_execute', { plan: first });
  assert.notEqual(result.status, 'completed');
  assert.equal(ctx.calls.filter((call) => call.tool === 'browser_act_many').length, 1);
  const status: any = await handleControlTool(ctx.value, 's1', 'control_plan_status', {
    planId: result.planId,
  });
  assert.equal(status.planId, result.planId);
});

test('mixed browser and desktop plan requires both independent grants', async () => {
  let desktopGranted = true;
  const ctx = controlContext();
  ctx.value.sessions.activeLease = () => null;
  ctx.value.deps.hostControlAccess = {
    identity: (id: string) => ({ kind: 'session', key: id }),
    has: (_id: string, capability: string) => capability === 'browser.control' || desktopGranted,
  };
  const browser: any = await handleControlTool(ctx.value, 's1', 'control_observe', {
    kind: 'browser',
    tabId: 't1',
  });
  const desktop: any = await handleControlTool(ctx.value, 's1', 'control_observe', {
    kind: 'desktop',
    windowId: 'w1',
  });
  const candidate = plan(browser.observation.surfaceId, browser.observation.observationId);
  candidate.surfaceIds.push(desktop.observation.surfaceId);
  candidate.expectedObservations[desktop.observation.surfaceId] = desktop.observation.observationId;
  desktopGranted = false;
  await assert.rejects(
    () => handleControlTool(ctx.value, 's1', 'control_execute', { plan: candidate }),
    { code: 'APPROVAL_PENDING' },
  );
  assert.equal(ctx.calls.filter((call) => call.tool === 'browser_act_many').length, 0);
});
