import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { areasFor, classify } from '../ci-changes.mjs';

const none = { node: false, web: false, extension: false, helper: false };
const all = { node: true, web: true, extension: true, helper: true };

test('docs and markdown alone need only the static checks', () => {
  assert.deepEqual(
    classify(['README.md', 'CHANGELOG.md', 'docs/specs/06-workspaces-execution.md']),
    none,
  );
});

test('the user manual runs node jobs because core tests and the package read it', () => {
  assert.deepEqual(classify(['docs/user-manual/14-troubleshooting.md']), { ...none, node: true });
});

test('each source area maps to its own jobs', () => {
  assert.deepEqual(classify(['apps/web-react/src/App.tsx']), { ...none, web: true });
  assert.deepEqual(classify(['tests/ui-parity/settings.spec.ts']), { ...none, web: true });
  assert.deepEqual(classify(['apps/extension/src/rpc.ts']), { ...none, extension: true });
  assert.deepEqual(classify(['helper/src/main.rs']), { ...none, helper: true });
  assert.deepEqual(classify(['apps/core/src/power/keep-awake-service.ts']), {
    ...none,
    node: true,
  });
  assert.deepEqual(classify(['packages/store/src/settings.ts']), { ...none, node: true });
});

test('shared admin contracts run both node and web jobs', () => {
  assert.deepEqual(classify(['packages/admin-contracts/src/api-types.ts']), {
    ...none,
    node: true,
    web: true,
  });
});

test('scripts map to the job that runs them and script tests stay static', () => {
  assert.deepEqual(areasFor('scripts/pack-extension.mjs'), ['extension']);
  assert.deepEqual(areasFor('scripts/stage-desktop-helpers.mjs'), ['helper']);
  assert.deepEqual(areasFor('scripts/test-coverage-node.mjs'), ['node']);
  assert.deepEqual(areasFor('scripts/test/ci-changes.test.mjs'), []);
});

test('workflow, dependency and build config changes run every job', () => {
  for (const file of [
    '.github/workflows/quality-gate.yml',
    'package.json',
    'package-lock.json',
    'tsconfig.build.json',
    'playwright.config.ts',
    'scripts/ci-changes.mjs',
  ]) {
    assert.deepEqual(classify([file]), all, file);
  }
});

test('an unknown path runs every job rather than risk skipping one', () => {
  assert.deepEqual(classify(['some-new-folder/thing.ts']), all);
});

test('windows separators are normalized', () => {
  assert.deepEqual(areasFor('apps\\web-react\\src\\App.tsx'), ['web']);
});

test('outside a pull request the script asks for every job', () => {
  const result = spawnSync(process.execPath, ['scripts/ci-changes.mjs'], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_EVENT_NAME: 'push', GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' },
  });
  assert.equal(result.status, 0, result.stderr);
  for (const area of ['node', 'web', 'extension', 'helper']) {
    assert.match(result.stdout, new RegExp(`^${area}=true$`, 'm'));
  }
});
