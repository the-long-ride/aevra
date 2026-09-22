import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { handleControlTool } from '../src/control-tools.js';
import { handleDesktopTool } from '../src/desktop-tools.js';
import { desktopContext } from './desktop-context.js';

function controlDesktopContext(options: Parameters<typeof desktopContext>[0] = {}) {
  const ctx = desktopContext(options);
  ctx.value.callInner = (sessionId: string, name: string, args: any) =>
    handleDesktopTool(ctx.value, sessionId, name, args);
  return ctx;
}

test('desktop_act_many executes semantic desktop operations through the existing policy path', async () => {
  const ctx = controlDesktopContext({ yolo: true });
  const result: any = await handleControlTool(ctx.value, 's1', 'desktop_act_many', {
    windowId: 'w1',
    requestId: 'batch-1',
    actions: [{ op: 'invoke', ref: 'ref_1_1' }],
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.steps[0]?.status, 'succeeded');
  assert.ok(ctx.worker.calls.some((call: any) => call.operation.kind === 'desktop.backgroundAct'));
  assert.ok(ctx.auditEntries.some((entry: any) => entry.tool === 'desktop_invoke'));
  assert.ok(ctx.auditEntries.some((entry: any) => entry.tool === 'control_execute'));
});

test('secret-shaped desktop batch data is refused before any semantic mutation or approval', async () => {
  const ctx = controlDesktopContext({ yolo: true });
  const outbound = createHash('sha256').update('control-plan-secret-fixture').digest('hex');

  await assert.rejects(
    () =>
      handleControlTool(ctx.value, 's1', 'desktop_act_many', {
        windowId: 'w1',
        requestId: 'batch-secret',
        actions: [{ op: 'type', ref: 'ref_1_1', text: outbound }],
      }),
    /secret-shaped data/,
  );

  assert.equal(
    ctx.worker.calls.some((call: any) => call.operation.kind === 'desktop.backgroundAct'),
    false,
  );
  assert.equal(ctx.approvals.requests.length, 0);
});

test('control plan status is owner-bound', async () => {
  const ctx = controlDesktopContext({ yolo: true });
  const result: any = await handleControlTool(ctx.value, 's1', 'desktop_act_many', {
    windowId: 'w1',
    requestId: 'batch-status',
    actions: [{ op: 'invoke', ref: 'ref_1_1' }],
  });
  const status: any = await handleControlTool(ctx.value, 's1', 'control_plan_status', {
    planId: result.planId,
  });
  assert.equal(status.planId, result.planId);
  assert.equal(status.status, 'completed');

  const other = controlDesktopContext({ yolo: true });
  await assert.rejects(
    () =>
      handleControlTool(other.value, 'other-session', 'control_plan_status', {
        planId: result.planId,
      }),
    /Control plan not found/,
  );
});
