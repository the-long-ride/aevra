import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTransferLimits } from '../../../packages/protocol/src/file-transfer.js';

test('the inline limit is capped at 256 MB while file and batch keep 1..10240', () => {
  assert.deepEqual(
    normalizeTransferLimits({ maxFileMb: 10240, maxBatchMb: 10240, inlineMb: 10240 }),
    { maxFileMb: 10240, maxBatchMb: 10240, inlineMb: 256 },
  );
  assert.equal(normalizeTransferLimits({ inlineMb: 100 }).inlineMb, 100);
});
