import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HmacEnvelopeSigner } from '../../../packages/ipc/src/envelope.js';
import { workerSocketPathForPlatform } from '../src/config.js';
import { loadOrCreateBrowserTokenKey, WorkerManager } from '../src/worker/worker-manager.js';

function tempDir(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-worker-branches-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const unavailable = (e: any) => e.code === 'EXECUTOR_UNAVAILABLE';

test('browser token key rejects keys of the wrong length', (t) => {
  const dir = tempDir(t);
  const keyPath = path.join(dir, 'nested', 'browser.key');
  mkdirSync(path.dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, Buffer.alloc(8).toString('base64url'));
  assert.throws(() => loadOrCreateBrowserTokenKey(keyPath), /Invalid browser token key/);
  assert.throws(() => loadOrCreateBrowserTokenKey(dir), (e: any) => e.code === 'EISDIR' || e.code === 'EPERM');
});

test('start refuses a missing worker build without spawning, then reports no key', async (t) => {
  const dir = tempDir(t);
  const keyPath = path.join(dir, 'keys', 'browser.key');
  const manager = new WorkerManager(workerSocketPathForPlatform(dir), path.join(dir, 'logs'), {
    entryPath: path.join(dir, 'missing-worker.mjs'),
    browserTokenKeyPath: keyPath,
  });
  await assert.rejects(() => manager.start(), /Execution Worker build is missing/);
  assert.equal(existsSync(keyPath), true, 'the persistent browser key is created before spawn');
  assert.equal(manager.browserTokenKey().length, 32);
  assert.deepEqual(manager.browserTokenKey(), loadOrCreateBrowserTokenKey(keyPath));
  await manager.close();
  assert.throws(() => manager.browserTokenKey(), unavailable);
});

test('execute without a started worker is unavailable', async () => {
  const manager = new WorkerManager('unused-endpoint');
  await assert.rejects(
    () => manager.execute({ sessionId: 's', workspaceId: 'w', roots: [], operation: { kind: 'process.list' } as any }),
    unavailable,
  );
  assert.throws(() => manager.browserTokenKey(), unavailable);
});

test('execute signs scope, expected state, and default host execution mode', async () => {
  const manager = new WorkerManager('unused-endpoint') as any;
  const envelopes: any[] = [];
  const client = { execute: async (envelope: any) => (envelopes.push(envelope), { ok: true, value: 'done' }), close: async () => {} };
  manager.client = client;
  manager.signer = new HmacEnvelopeSigner(Buffer.alloc(32, 1), manager.daemonInstanceId);
  assert.equal(await manager.start(), client, 'an existing client is reused');
  const scope = { kind: 'host-control', capability: 'desktop.control', identity: { kind: 'session', key: 'k' } };
  assert.deepEqual(
    await manager.execute({ sessionId: 's', workspaceId: 'w', scope, roots: [], operation: { kind: 'process.list' }, expectedState: { head: '1' } }),
    { ok: true, value: 'done' },
  );
  await manager.execute({ sessionId: 's', workspaceId: 'w', roots: [], operation: { kind: 'process.list' }, executionMode: 'sandbox' });
  const text = JSON.stringify(envelopes);
  assert.match(text, /desktop\.control/);
  assert.match(text, /"head":"1"/);
  assert.match(text, /"executionMode":"host"/);
  assert.match(text, /"executionMode":"sandbox"/);
  assert.equal(text.includes('expectedState'), true);
  assert.equal(JSON.stringify(envelopes[1]).includes('expectedState'), false);
  assert.equal(JSON.stringify(envelopes[1]).includes('"scope"'), false);
  await manager.close();
  assert.equal(manager.client, undefined);
});

test('startup with a zero timeout reports a startup timeout and stops the child', async (t) => {
  const dir = tempDir(t);
  const entry = path.join(dir, 'idle-worker.mjs');
  writeFileSync(entry, 'setInterval(() => {}, 1000);\n');
  const manager = new WorkerManager(workerSocketPathForPlatform(dir), path.join(dir, 'logs'), {
    entryPath: entry,
    startupTimeoutMs: 0,
  });
  await assert.rejects(() => manager.start(), /did not become ready: startup timeout$/);
  assert.equal((manager as any).child, undefined);
  await manager.close();
});

test('bootstrap diagnostics keep only the tail of very long stderr output', async (t) => {
  const dir = tempDir(t);
  const entry = path.join(dir, 'noisy-worker.mjs');
  writeFileSync(entry, "process.stderr.write('x'.repeat(20000) + 'TAIL-MARKER', () => process.exit(3));\n");
  const manager = new WorkerManager(workerSocketPathForPlatform(dir), path.join(dir, 'logs'), {
    entryPath: entry,
    startupPollMs: 10,
  });
  const error: Error = await manager.start().then(
    () => assert.fail('start should fail'),
    (e) => e,
  );
  assert.match(error.message, /^Execution Worker exited 3: x+TAIL-MARKER$/);
  assert.ok(error.message.length <= 8192 + 40, `message length ${error.message.length}`);
  await manager.close();
});
