import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeLogicalPath } from '../src/logical-path.js';

test('every spelling of the same path normalises to one form', () => {
  for (const spelling of [
    'aevra.json',
    '/aevra.json',
    './aevra.json',
    '.\\aevra.json',
    '//aevra.json',
    'sub/../aevra.json',
    '/./sub/./../aevra.json',
  ]) {
    assert.equal(normalizeLogicalPath(spelling), '/aevra.json', spelling);
  }
});

test('a trailing separator does not survive', () => {
  assert.equal(normalizeLogicalPath('vendor/keys/'), '/vendor/keys');
  assert.equal(normalizeLogicalPath('vendor\\keys\\'), '/vendor/keys');
});

test('the root stays the root', () => {
  for (const spelling of ['', '/', '.', './', '..', '../..']) {
    assert.equal(normalizeLogicalPath(spelling), '/', JSON.stringify(spelling));
  }
});

test('a leading .. cannot escape, it is anchored at the root', () => {
  assert.equal(normalizeLogicalPath('../../secrets/key'), '/secrets/key');
});

test('non-string input does not throw', () => {
  assert.equal(normalizeLogicalPath(undefined as unknown as string), '/');
});
