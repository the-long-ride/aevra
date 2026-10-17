import assert from 'node:assert/strict';
import test from 'node:test';
import { boundedClone } from '../src/mcp/activity-bounds.js';

test('dates keep their ISO form and an invalid date becomes null', () => {
  assert.equal(boundedClone(new Date(Date.UTC(2026, 0, 2, 3, 4, 5))), '2026-01-02T03:04:05.000Z');
  assert.equal(boundedClone(new Date(Number.NaN)), null);
});

test('maps and sets are logged as arrays', () => {
  assert.deepEqual(boundedClone(new Map([['a', 1]])), [['a', 1]]);
  assert.deepEqual(boundedClone(new Set([1, 2])), [1, 2]);
});

test('undefined and function properties are dropped like JSON.stringify does', () => {
  assert.deepEqual(boundedClone({ a: 1, b: undefined, c: () => 1 }), { a: 1 });
});

test('a throwing toJSON degrades instead of failing the log call', () => {
  const hostile = {
    toJSON(): never {
      throw new Error('boom');
    },
  };
  assert.deepEqual(boundedClone({ hostile }), { hostile: '[unserializable]' });
});

test('a hard cut never leaves half of a surrogate pair', () => {
  const text = `${'a'.repeat(1999)}\u{1F600}${'b'.repeat(10)}`;
  const cut = boundedClone(text) as string;
  assert.ok(cut.startsWith('a'.repeat(1999)));
  assert.match(cut, /\[12 more chars\]$/);
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(cut), 'no lone high surrogate');
});
