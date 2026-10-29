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

test('Windows drive-letter absolute paths normalise without throwing while ADS colons are rejected', () => {
  assert.equal(
    normalizeLogicalPath('D:\\design-system\\icons\\close.svg'),
    '/D:/design-system/icons/close.svg',
  );
  assert.equal(normalizeLogicalPath('C:/shared/./lib/../item.ts'), '/C:/shared/item.ts');
  assert.equal(normalizeLogicalPath('D:\\..\\escape.txt'), '/D:/escape.txt');
  if (process.platform === 'win32') {
    assert.throws(
      () => normalizeLogicalPath('D:\\shared\\secret.txt:$DATA'),
      (e: any) => e.code === 'INVALID_REQUEST',
    );
  }
});
