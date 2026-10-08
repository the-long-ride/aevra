import assert from 'node:assert/strict';
import test from 'node:test';
import { UNTRUSTED_CONTENT_NOTICE } from '../../security/src/untrusted.js';
import { isBatchResult, shapeBatchResult } from '../src/result-shaper/batch.js';

const fileItem = (index: number, path: string, content: string) => ({
  index,
  ok: true,
  path,
  value: {
    path,
    hash: 'sha256:abc',
    content,
    offset: 0,
    length: content.length,
    totalLength: content.length,
    sensitivity: 'NORMAL',
    untrusted: true,
    notice: UNTRUSTED_CONTENT_NOTICE,
  },
});

test('isBatchResult recognises the batch envelope only', () => {
  assert.equal(
    isBatchResult({ ok: true, count: 1, succeeded: 1, failed: 0, skipped: 0, results: [] }),
    true,
  );
  assert.equal(isBatchResult({ results: [] }), false);
  assert.equal(isBatchResult(null), false);
});

test('file batches drop repeated metadata and hoist the untrusted notice', () => {
  const data = {
    ok: true,
    count: 2,
    succeeded: 2,
    failed: 0,
    skipped: 0,
    results: [fileItem(0, '/a.txt', 'alpha'), fileItem(1, '/b.txt', 'beta')],
  };
  const shaped = shapeBatchResult(data, 16000) as any;
  assert.equal(shaped.failed, undefined);
  assert.equal(shaped.skipped, undefined);
  assert.equal(shaped.untrusted, true);
  assert.equal(shaped.notice, UNTRUSTED_CONTENT_NOTICE);
  assert.deepEqual(shaped.results[0], {
    ok: true,
    path: '/a.txt',
    value: { hash: 'sha256:abc', content: 'alpha', offset: 0, length: 5, totalLength: 5 },
  });
  assert.equal('index' in shaped.results[0], false);
});

test('file content is never altered or truncated', () => {
  const content = 'line\r\n'.repeat(5000);
  const shaped = shapeBatchResult(
    {
      ok: true,
      count: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      results: [fileItem(0, '/big', content)],
    },
    256,
  ) as any;
  assert.equal(shaped.results[0].value.content, content);
});

test('a non-standard notice and non-NORMAL sensitivity are kept', () => {
  const item = fileItem(0, '/a', 'x');
  item.value.notice = 'custom notice';
  item.value.sensitivity = 'SENSITIVE';
  const shaped = shapeBatchResult(
    { ok: true, count: 1, succeeded: 1, failed: 0, skipped: 0, results: [item] },
    16000,
  ) as any;
  assert.equal(shaped.notice, undefined);
  assert.equal(shaped.results[0].value.notice, 'custom notice');
  assert.equal(shaped.results[0].value.sensitivity, 'SENSITIVE');
});

test('command batches unwrap the inner ok wrapper and shape output', () => {
  const data = {
    ok: false,
    count: 2,
    succeeded: 1,
    failed: 1,
    skipped: 0,
    results: [
      {
        index: 0,
        ok: true,
        value: {
          ok: true,
          value: { exitCode: 0, signal: null, stdout: 'done\r\n', stderr: '', durationMs: 5 },
        },
      },
      { index: 1, ok: false, error: { code: 'COMMAND_FAILED', message: 'no' } },
    ],
  };
  const shaped = shapeBatchResult(data, 16000) as any;
  assert.equal(shaped.failed, 1);
  assert.deepEqual(shaped.results[0], {
    ok: true,
    value: { exitCode: 0, stdout: 'done\n', durationMs: 5 },
  });
  assert.deepEqual(shaped.results[1], {
    ok: false,
    error: { code: 'COMMAND_FAILED', message: 'no' },
  });
});
