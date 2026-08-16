import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}
test('package metadata exposes only gateway runtime assets', async () => {
  const pkg = await readJson('package.json');
  assert.equal(pkg.bin?.aevra, 'dist/apps/cli/src/cli.js');
  assert.equal(pkg.scripts?.prepare, 'npm run build');
  for (const kept of ['dist', 'installers', 'README.md'])
    assert.equal(pkg.files?.includes(kept), true, `${kept} must be published`);
  assert.deepEqual(pkg.dependencies ?? {}, {});
});
