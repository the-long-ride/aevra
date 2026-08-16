import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}
test('package metadata exposes only gateway runtime assets', async () => {
  const pkg = await readJson('package.json');
  assert.equal(pkg.name, '@the-long-ride/aevra');
  assert.equal(pkg.bin?.aevra, 'dist/apps/cli/src/cli.js');
  assert.equal(pkg.scripts?.prepare, 'npm run build');

  const runtimePaths = [
    'dist/apps/cli/src',
    'dist/apps/core/src',
    'dist/apps/worker/src',
    'dist/packages/executor/src',
    'dist/packages/security/src',
    'docs/user-manual',
    'installers',
    'README.md',
    'GUIDELINE.md',
    'CHANGELOG.md',
  ];
  for (const p of runtimePaths) assert.equal(pkg.files?.includes(p), true, `${p} must be in files`);

  // test directories must never appear in files
  const forbidden = ['dist', 'dist/tests', 'scripts', '.env.example', 'docs/specs'];
  for (const p of forbidden)
    assert.equal(pkg.files?.includes(p), false, `${p} must NOT be in files`);

  assert.deepEqual(pkg.dependencies ?? {}, {});
});
