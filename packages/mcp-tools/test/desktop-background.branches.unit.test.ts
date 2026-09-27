import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraToolError } from '../src/errors.js';
import { backgroundActRisk, handleBackgroundAction } from '../src/desktop-background.js';

function fixture(o: any = {}) {
  const ops: any[] = [];
  const audits: any[] = [];
  const context: any = {
    sessions: { get: () => ({ id: 's1', actor: 'oauth:ChatGPT' }), isYolo: () => false },
    worker: {
      execute: async (input: any) => {
        ops.push(input.operation);
        if (o.fail) return { ok: false, error: o.fail };
        return { ok: true, value: o.value ?? { done: true } };
      },
    },
    deps: {
      audit: { append: (row: any) => audits.push(row) },
      permissions: { decide: () => ({ outcome: 'allow' }) },
      hostControlAccess: { has: () => true, identity: () => ({ kind: 'session', key: 's1' }) },
    },
  };
  return { context, ops, audits };
}

test('background risk tiers', () => {
  assert.equal(backgroundActRisk('desktop_set_value'), 'HIGH');
  assert.equal(backgroundActRisk('desktop_release_window'), 'LOW');
  assert.equal(backgroundActRisk('desktop_invoke'), 'MEDIUM');
});

test('release window defaults ids and audits success and sanitized failure', async () => {
  const f = fixture();
  const ok: any = await handleBackgroundAction(f.context, 's1', 'desktop_release_window', {}, 'LOW');
  assert.equal(ok.done, true);
  assert.equal(ok.untrusted, true);
  assert.deepEqual(f.ops[0], { kind: 'desktop.releaseWindow', windowId: '', windowLeaseId: '' });
  assert.equal(f.audits[0].result, 'SUCCEEDED');
  assert.equal(f.audits[0].target, 'window:undefined');

  const failing = fixture({
    fail: {
      code: 'DESKTOP_UNAVAILABLE',
      message: 'lease gone',
      details: { window: { windowId: 'w1', executablePath: 'C:\\Apps\\x.exe' } },
    },
  });
  await assert.rejects(
    () =>
      handleBackgroundAction(failing.context, 's1', 'desktop_release_window', { windowId: 'w1' }, 'LOW'),
    (e: any) => e.code === 'DESKTOP_UNAVAILABLE' && e.details.window.executablePath === 'x.exe',
  );
  assert.equal(failing.audits[0].result, 'FAILED');
});

test('unknown background operations are rejected', async () => {
  const f = fixture();
  await assert.rejects(
    () => handleBackgroundAction(f.context, 's1', 'desktop_hover', {}, 'MEDIUM'),
    /Unknown background desktop operation: desktop_hover/,
  );
  assert.equal(f.ops.length, 0);
});

test('actions with missing arguments send empty identifiers and a plain result', async () => {
  const f = fixture({ value: { ok: true } });
  const result: any = await handleBackgroundAction(f.context, 's1', 'desktop_invoke', {}, 'MEDIUM');
  assert.equal(result.ok, true);
  assert.deepEqual(f.ops[0].action, {
    windowId: '',
    windowLeaseId: '',
    snapshotId: '',
    ref: '',
    op: 'invoke',
  });
  const row = f.audits[0];
  assert.equal(row.window, 'unknown-window');
  assert.equal('gateVerdict' in row, false);
  assert.equal(row.target, ':');
});

test('setValue without a value sends empty text and counts zero characters', async () => {
  const f = fixture({
    value: { window: { windowId: 'w1', processName: 'app.exe', title: 'App' }, gateVerdict: 'allow', gateRule: 'r' },
  });
  const args: any = { windowId: 'w1', ref: 'e1' };
  const result: any = await handleBackgroundAction(f.context, 's1', 'desktop_set_value', args, 'HIGH');
  assert.equal(result.window.processName, 'app.exe');
  assert.equal(f.ops[0].action.value, '');
  assert.equal(f.audits[0].target, 'w1:e1 (0 chars)');
  assert.equal(f.audits[0].gateVerdict, 'allow');
  assert.equal(f.audits[0].window, 'app.exe');
  assert.equal(args.requestNonce, undefined, 'no nonce is minted without a string value');
});

test('setValue mints a nonce once and failures audit the refused window', async () => {
  const f = fixture({
    fail: {
      code: 'DESKTOP_INPUT_REFUSED',
      message: 'refused',
      details: { window: { windowId: 'w1', processName: 'app.exe' }, gateVerdict: 'deny', gateRule: 'rule' },
    },
  });
  const args: any = { windowId: 'w1', ref: 'e1', value: 'hello' };
  await assert.rejects(
    () => handleBackgroundAction(f.context, 's1', 'desktop_set_value', args, 'HIGH'),
    (e: any) => e.code === 'DESKTOP_INPUT_REFUSED' && e.details.accessRequestAvailable === false,
  );
  assert.equal(typeof args.requestNonce, 'string');
  assert.equal(f.audits[0].result, 'FAILED');
  assert.equal(f.audits[0].window, 'app.exe');
  assert.equal(f.audits[0].gateVerdict, 'deny');
  assert.equal(f.audits[0].target, 'w1:e1 (5 chars)');

  const bare = fixture({ fail: { code: 'DESKTOP_UNAVAILABLE', message: 'x' } });
  await assert.rejects(
    () => handleBackgroundAction(bare.context, 's1', 'desktop_toggle', { ref: 'e2' }, 'MEDIUM'),
    (e: any) => e instanceof AevraToolError && e.code === 'DESKTOP_UNAVAILABLE',
  );
  assert.equal('window' in bare.audits[0], false);
  assert.equal('gateVerdict' in bare.audits[0], false);
});
