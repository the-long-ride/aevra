import assert from 'node:assert/strict';
import test from 'node:test';
import { testFileBatches } from '../lib/test-file-batches.mjs';

test('Windows-sized test invocations keep every file without exceeding the command budget', () => {
  const files = ['first.test.js', 'second.test.js', 'third.test.js'];
  assert.deepEqual(testFileBatches(files, 34), [
    ['first.test.js', 'second.test.js'],
    ['third.test.js'],
  ]);
  const many = Array.from(
    { length: 700 },
    (_, index) => `apps/core/test/long-regression-filename-${index}.integration.test.js`,
  );
  const batches = testFileBatches(many);
  assert.ok(batches.length > 1);
  assert.deepEqual(batches.flat(), many);
  assert.ok(
    batches.every((batch) => batch.reduce((sum, file) => sum + file.length + 3, 0) <= 24_000),
  );
});
