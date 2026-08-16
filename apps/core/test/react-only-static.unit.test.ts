import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { parseAdminDestination } from '../src/admin/bootstrap-destination.js';
import { resolveStaticAsset } from '../src/admin/static-files.js';

test('admin bootstrap accepts only the React root destination', () => {
  assert.equal(parseAdminDestination(undefined), '/');
  assert.equal(parseAdminDestination('/'), '/');
  assert.equal(parseAdminDestination('/react'), null);
  assert.equal(parseAdminDestination('/react/'), null);
  assert.equal(parseAdminDestination('https://example.test'), null);
});

test('static root maps slash to React index without a special react sub-root', () => {
  const root = path.resolve('/tmp/aevra-static');
  assert.equal(resolveStaticAsset(root, '/'), path.join(root, 'index.html'));
  assert.equal(resolveStaticAsset(root, '/assets/app.js'), path.join(root, 'assets', 'app.js'));
  assert.equal(resolveStaticAsset(root, '/react/'), path.join(root, 'react'));
  assert.equal(resolveStaticAsset(root, '/../secret'), null);
});
