import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { resolveStaticAsset } from '../src/admin/static-files.js';

const root = path.resolve('/tmp/aevra-web');

test('static resolver rejects traversal and malformed encoded paths', () => {
  for (const pathname of [
    '/../secret',
    '/../../secret',
    '/nested/../../../secret',
    '/%2e%2e/secret',
    '/%E0%A4%A',
  ]) {
    assert.equal(resolveStaticAsset(root, pathname), null, pathname);
  }
});
