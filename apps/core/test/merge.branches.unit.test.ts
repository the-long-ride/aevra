import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeText } from '../src/operations/merge.js';

test('mergeText merges disjoint edits, insertions, and keeps CRLF from current', () => {
  assert.deepEqual(mergeText('a\nb\nc\nd', 'A\nb\nc\nd', 'a\nb\nc\nD'), {
    kind: 'merged',
    content: 'A\nb\nc\nD',
  });
  assert.deepEqual(mergeText('a\nb\nc', 'a\r\nb\r\nc\r\nextra', 'z\nb\nc'), {
    kind: 'merged',
    content: 'z\r\nb\r\nc\r\nextra',
  });
  assert.deepEqual(mergeText('a\nb\nc', 'a\nb\nc', 'a\nb\nc'), {
    kind: 'merged',
    content: 'a\nb\nc',
  });
  assert.deepEqual(mergeText('a\nb\nc', 'a\nc', 'a\nb\nc\nnew'), {
    kind: 'merged',
    content: 'a\nc\nnew',
  });
});

test('mergeText reports conflicts for overlapping edits and same-point insertions', () => {
  assert.deepEqual(mergeText('a\nb\nc', 'a\nX\nc', 'a\nY\nc'), {
    kind: 'conflict',
    ranges: [{ baseStart: 1, baseEnd: 2 }],
  });
  assert.equal(mergeText('a\nb', 'a\nX\nb', 'a\nY\nb').kind, 'conflict');
  assert.equal(mergeText('a\nb\nc', 'a\nINS\nb\nc', 'a\nc').kind, 'conflict');
  assert.equal(mergeText('a\nb\nc', 'a\nc', 'a\nINS\nb\nc').kind, 'conflict');
  assert.equal(mergeText('a\nb\nc', 'a\nc', 'a\nINS\nc').kind, 'conflict');
});
