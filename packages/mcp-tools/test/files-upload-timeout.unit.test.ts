import assert from 'node:assert/strict';
import test from 'node:test';
import { transferTimeoutMs } from '../src/transfer-entries.js';
import { makeHarness, MB } from './transfer-harness.js';

const readOp = async (size: number) => {
  const h = makeHarness({
    yolo: 'do-whatever',
    readable: { '/data/f.bin': { data: Buffer.alloc(size, 1) } },
  });
  try {
    await h.service.call('s1', 'files_upload', {
      workspaceId: 'w1',
      paths: ['/data/f.bin'],
      delivery: 'inline',
    });
    return h.ops.find((op: any) => op.kind === 'files.upload.read');
  } finally {
    h.close();
  }
};

test('the helper clamps and grows with size', () => {
  assert.equal(transferTimeoutMs(1), 300_000);
  assert.ok(transferTimeoutMs(400 * MB) > transferTimeoutMs(100 * MB));
  assert.equal(transferTimeoutMs(Number.MAX_SAFE_INTEGER), 3_600_000);
});

test('an inline files.upload.read carries a finite timeoutMs of at least 5 minutes', async () => {
  const op = await readOp(1024);
  assert.ok(Number.isFinite(op.timeoutMs));
  assert.ok(op.timeoutMs >= 300_000);
});
