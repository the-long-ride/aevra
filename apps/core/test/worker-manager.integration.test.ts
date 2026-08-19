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
  writeFileSync(entry, "console.error('worker-bootstrap-boom'); process.exit(1);\n");
  const manager = new WorkerManager(
    workerSocketPathForPlatform(dir),
    path.join(dir, 'process-logs'),
    { entryPath: entry } as any,
  );
  await assert.rejects(manager.start(), /worker-bootstrap-boom/);
  await manager.close();
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
  const client = await manager.start();
  const health = await client.health();
  assert.equal(health.ready, true);
  assert.ok(health.pid > 0);
  await manager.close();
  assert.throws(() => process.kill(health.pid, 0));
});
