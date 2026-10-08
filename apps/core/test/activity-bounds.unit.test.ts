import assert from 'node:assert/strict';
import test from 'node:test';
import { boundedClone } from '../src/mcp/activity-bounds.js';

test('small values are copied unchanged', () => {
  const value = { a: 1, b: ['x', true, null], c: { d: 'e' } };
  assert.deepEqual(boundedClone(value), value);
  assert.notEqual(boundedClone(value), value);
});

test('long strings are cut with a count marker', () => {
  const cut = boundedClone('a'.repeat(5000)) as string;
  assert.ok(cut.length < 2100);
  assert.match(cut, /… \[3000 more chars\]$/);
});

test('the cut prefers a whitespace boundary so a token is not split mid-way', () => {
  const text = `${'a'.repeat(1950)} ${'k'.repeat(100)}`;
  const cut = boundedClone(text) as string;
  assert.ok(!cut.startsWith(`${'a'.repeat(1950)} k`), 'token must not be partly kept');
  assert.ok(cut.startsWith('a'.repeat(1950)));
});

test('arrays keep 50 items and note the rest', () => {
  const cut = boundedClone(Array.from({ length: 80 }, (_, i) => i)) as unknown[];
  assert.equal(cut.length, 51);
  assert.equal(cut[50], '… 30 more items');
});

test('objects keep 200 keys and note the rest', () => {
  const big = Object.fromEntries(Array.from({ length: 230 }, (_, i) => [`k${i}`, i]));
  const cut = boundedClone(big) as Record<string, unknown>;
  assert.equal(Object.keys(cut).length, 201);
  assert.equal(cut['…'], '30 more keys');
});

test('depth is limited and cycles cannot hang', () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const cut = JSON.stringify(boundedClone(circular));
  assert.match(cut, /\[depth limit\]/);
});

test('non-JSON values degrade to strings or null', () => {
  assert.equal(boundedClone(undefined), null);
  assert.equal(boundedClone(10n), '10');
  assert.equal(
    boundedClone(() => 1),
    null,
  );
});
