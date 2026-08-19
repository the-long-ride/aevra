import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { resolveStaticAsset } from '../src/admin/static-files.js';

const root = path.resolve('/tmp/aevra-web');

test('static resolver maps vanilla and React directory entries', () => {
  assert.equal(resolveStaticAsset(root, '/'), path.join(root, 'index.html'));
  assert.equal(resolveStaticAsset(root, '/react/'), path.join(root, 'react', 'index.html'));
  assert.equal(resolveStaticAsset(root, '/react'), path.join(root, 'react', 'index.html'));
  assert.equal(
    resolveStaticAsset(root, '/react/assets/app.js'),
    path.join(root, 'react', 'assets', 'app.js'),
  );
});

test('static resolver rejects traversal and malformed encoded paths', () => {
  for (const pathname of [
    '/../secret',
    '/../../secret',
    '/react/../../../secret',
    '/%2e%2e/secret',
    '/%E0%A4%A',
  ]) {
    assert.equal(resolveStaticAsset(root, pathname), null, pathname);
  }
});
