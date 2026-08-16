import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WorkerManager } from '../src/worker/worker-manager.js';
import { workerSocketPathForPlatform } from '../src/config.js';

test('worker manager includes child stderr when bootstrap exits', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-worker-fail-'));
  const entry = path.join(dir, 'fail-worker.mjs');
  writeFileSync(
    entry,
    "console.log('worker-stdout-boom'); console.error('worker-bootstrap-boom'); process.exit(1);\n",
  );
  const manager = new WorkerManager(
    workerSocketPathForPlatform(dir),
    path.join(dir, 'process-logs'),
    { entryPath: entry } as any,
  );
  await assert.rejects(manager.start(), /worker-bootstrap-boom/);
  await manager.close();

  const zeroExitEntry = path.join(dir, 'zero-worker.mjs');
  writeFileSync(zeroExitEntry, 'process.exit(0);\n');
  const zeroManager = new WorkerManager(
    workerSocketPathForPlatform(dir),
    path.join(dir, 'process-logs'),
    { entryPath: zeroExitEntry } as any,
  );
  await assert.rejects(zeroManager.start(), /Execution Worker exited 0/);
  await zeroManager.close();

  const timeoutEntry = path.join(dir, 'timeout-worker.mjs');
  writeFileSync(timeoutEntry, 'setInterval(() => {}, 1000);\n');
  const timeoutManager = new WorkerManager(
    workerSocketPathForPlatform(dir),
    path.join(dir, 'process-logs'),
    { entryPath: timeoutEntry, startupTimeoutMs: 150, startupPollMs: 30 } as any,
  );
  await assert.rejects(timeoutManager.start(), /Execution Worker did not become ready/);
  await timeoutManager.close();
});

test('Windows worker endpoint is unique per core process', () => {
  assert.equal(
    workerSocketPathForPlatform('C:\\state', 'win32', 4242),
    '\\\\.\\pipe\\aevra-worker-4242',
  );
  assert.equal(
    workerSocketPathForPlatform('/tmp/aevra', 'linux', 4242),
    path.join('/tmp/aevra', 'worker.sock'),
  );
});

test('worker manager starts the packaged worker from its module location and fully stops it', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-worker-live-'));
  const manager = new WorkerManager(
    workerSocketPathForPlatform(dir),
    path.join(dir, 'process-logs'),
  );

  await assert.rejects(
    () =>
      manager.execute({
        sessionId: 's',
        workspaceId: 'w',
        roots: [],
        operation: { kind: 'file.read', path: '/x' },
      }),
    /Execution Worker unavailable/,
  );

  const missingManager = new WorkerManager(
    workerSocketPathForPlatform(dir),
    path.join(dir, 'process-logs'),
    { entryPath: '/nonexistent/path/worker.js' },
  );
  await assert.rejects(() => missingManager.start(), /Execution Worker build is missing/);

  const client = await manager.start();
  const health = await client.health();
  assert.equal(health.ready, true);
  assert.ok(health.pid > 0);

  const result = await manager.execute({
    sessionId: 's',
    workspaceId: 'w',
    roots: [],
    operation: { kind: 'file.read', path: '/x' },
    expectedState: { head: '123' },
    executionMode: 'host',
  });
  assert.ok(result);

  const defaultExecResult = await manager.execute({
    sessionId: 's',
    workspaceId: 'w',
    roots: [],
    operation: { kind: 'sandbox.inspect' },
  });
  assert.ok(defaultExecResult);

  await manager.close();
  // Second close is no-op
  await manager.close();
  assert.throws(() => process.kill(health.pid, 0));
});
