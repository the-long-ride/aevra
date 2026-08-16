import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeText } from '../src/operations/merge.js';
test('safe three-way merge combines non-overlapping lines', () => {
  const base = 'a\nb\nc\nd',
    current = 'A\nb\nc\nd',
    requested = 'a\nb\nc\nD';
  const r = mergeText(base, current, requested);
  assert.equal(r.kind, 'merged');
  assert.equal((r as any).content, 'A\nb\nc\nD');
});
test('same-line edits conflict', () => {
  assert.equal(mergeText('a\nb', 'A\nb', 'X\nb').kind, 'conflict');
});
test('delete versus overlapping edit conflicts', () => {
  assert.equal(mergeText('a\nb\nc', 'a\nc', 'a\nB\nc').kind, 'conflict');
});
