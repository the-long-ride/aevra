import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
const removed = [
  ['apps', 'extension'].join('/'),
  ['native', 'host'].join('-'),
  ['scripts', 'build-extension.mjs'].join('/'),
];
test('obsolete browser integration surfaces are absent', () => {
  for (const item of removed) assert.equal(existsSync(item), false, item);
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.bin.aevra, 'dist/apps/cli/src/cli.js');
});
