import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
// The removed surfaces are the *legacy* browser integration. The MV3
// extension under apps/extension supersedes it and is expected to exist;
// what must stay gone is the native-messaging host and its build script.
const removed = [['native', 'host'].join('-'), ['scripts', 'build-extension.mjs'].join('/')];
test('obsolete browser integration surfaces are absent', () => {
  for (const item of removed) assert.equal(existsSync(item), false, item);
  assert.equal(existsSync(['apps', 'extension', 'manifest.json'].join('/')), true);
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.bin.aevra, 'dist/apps/cli/src/cli.js');
});
