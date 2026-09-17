import assert from 'node:assert/strict';
import test from 'node:test';
import { compileGlob } from '../src/glob.js';

test('a literal path matches only itself', () => {
  const re = compileGlob('config/local.json')!;
  assert.equal(re.test('config/local.json'), true);
  assert.equal(re.test('config/local.json.bak'), false);
  assert.equal(re.test('other/config/local.json'), false);
});

test('* matches within one path segment, not across / or \\', () => {
  const re = compileGlob('*.local.*')!;
  assert.equal(re.test('settings.local.json'), true);
  assert.equal(re.test('a/settings.local.json'), false);
  assert.equal(re.test('a\\settings.local.json'), false);
});

test('** matches across path segments, including zero', () => {
  const re = compileGlob('vendor/private-keys/nested/**')!;
  assert.equal(re.test('vendor/private-keys/nested/id_rsa'), true);
  assert.equal(re.test('vendor/private-keys/nested/deep/id_rsa'), true);
  assert.equal(re.test('vendor/other/id_rsa'), false);
});

test('** alone matches everything', () => {
  const re = compileGlob('**')!;
  assert.equal(re.test('anything/at/all'), true);
  assert.equal(re.test(''), true);
});

test('regex-special characters in the pattern are treated literally', () => {
  const re = compileGlob('a+b.txt')!;
  assert.equal(re.test('a+b.txt'), true);
  assert.equal(re.test('aXb.txt'), false);
});

test('matching is anchored to the full path, not a substring', () => {
  const re = compileGlob('secret.txt')!;
  assert.equal(re.test('not-secret.txt'), false);
  assert.equal(re.test('secret.txt.bak'), false);
});

test('an empty pattern fails to compile rather than matching everything', () => {
  assert.equal(compileGlob(''), null);
});

test('a single leading slash in the tested path is tolerated', () => {
  const re = compileGlob('config/local.json')!;
  assert.equal(re.test('/config/local.json'), true);
  assert.equal(re.test('//config/local.json'), false);
});

test('a backslash separator in the tested path matches a / in the pattern', () => {
  const re = compileGlob('vendor/keys/id_rsa')!;
  assert.equal(re.test('vendor\\keys\\id_rsa'), true);
  assert.equal(re.test('vendor\\keys/id_rsa'), true);
});

test('matching is case-insensitive', () => {
  const re = compileGlob('Vendor/Keys/id_rsa')!;
  assert.equal(re.test('vendor/keys/ID_RSA'), true);
});

test('a trailing /** also matches the directory itself, not only its contents', () => {
  const re = compileGlob('vendor/keys/**')!;
  assert.equal(re.test('vendor/keys'), true);
  assert.equal(re.test('vendor/keys/id_rsa'), true);
  assert.equal(re.test('vendor/keys/nested/id_rsa'), true);
  assert.equal(re.test('vendor/keysextra'), false);
});

test('a leading **/ also matches at depth zero, not only nested', () => {
  const re = compileGlob('**/id_rsa')!;
  assert.equal(re.test('id_rsa'), true);
  assert.equal(re.test('vendor/keys/id_rsa'), true);
  assert.equal(re.test('id_rsa.pub'), false);
});
