import assert from 'node:assert/strict';
import test from 'node:test';
import { HmacEnvelopeSigner } from '../../../packages/ipc/src/envelope.js';
import { runtimeWorkerGateway } from '../src/runtime-support.js';
import { WorkerManager } from '../src/worker/worker-manager.js';

async function* bytes() {
  yield Uint8Array.from(Buffer.from('plain words'));
}

function manager() {
  const seen: any[] = [];
  const wm = new WorkerManager('endpoint');
  (wm as any).signer = new HmacEnvelopeSigner(Buffer.alloc(32, 1), wm.daemonInstanceId);
  (wm as any).client = {
    execute: async (envelope: any) => {
      seen.push(['execute', envelope]);
      return { ok: true, value: 'plain' };
    },
    executeWithUpload: async (envelope: any, source: AsyncIterable<Uint8Array>) => {
      const parts: Buffer[] = [];
      for await (const chunk of source) parts.push(Buffer.from(chunk));
      seen.push(['upload', envelope, Buffer.concat(parts).toString()]);
      return { ok: true, value: 'uploaded' };
    },
    executeWithDownload: async (envelope: any) => {
      seen.push(['download', envelope]);
      return { result: Promise.resolve({ ok: true, value: 'downloaded' }), body: bytes() };
    },
  };
  return { wm, seen };
}

const input = {
  sessionId: 's1',
  workspaceId: 'w1',
  roots: [],
  operation: { kind: 'files.upload.stat', path: '/a.txt' } as any,
};

test('the worker manager signs stream operations like plain ones', async () => {
  const { wm, seen } = manager();
  const up: any = await wm.executeWithUpload(input, bytes());
  const down = await wm.executeWithDownload(input);
  assert.equal(up.value, 'uploaded');
  assert.equal((await down.result).ok, true);
  assert.equal(seen[0][0], 'upload');
  assert.equal(seen[0][2], 'plain words');
  assert.equal(typeof seen[0][1].mac, 'string');
  assert.equal(seen[0][1].operation.path, '/a.txt');
  assert.equal(seen[1][0], 'download');
});

test('the runtime gateway exposes stream calls only when the worker is live', async () => {
  const { wm } = manager();
  const live = runtimeWorkerGateway(wm, false);
  assert.equal(typeof live.executeWithUpload, 'function');
  assert.equal(typeof live.executeWithDownload, 'function');
  const safe = runtimeWorkerGateway(wm, true);
  assert.equal(safe.executeWithUpload, undefined);
  assert.equal(safe.executeWithDownload, undefined);
});

test('stream calls fail clearly when the worker is not started', async () => {
  const wm = new WorkerManager('endpoint');
  await assert.rejects(
    () => wm.executeWithUpload(input, bytes()),
    (e: any) => e.code === 'EXECUTOR_UNAVAILABLE',
  );
  await assert.rejects(
    () => wm.executeWithDownload(input),
    (e: any) => e.code === 'EXECUTOR_UNAVAILABLE',
  );
});
