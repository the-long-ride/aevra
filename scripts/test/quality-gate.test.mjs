import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const workflow = readFileSync('.github/workflows/quality-gate.yml', 'utf8');
const coverageRunner = readFileSync('scripts/test-coverage-node.mjs', 'utf8');
const gitignore = readFileSync('.gitignore', 'utf8');

test('full repository gate covers every release-quality check', () => {
  const gate = pkg.scripts['test:gate'];
  for (const command of [
    'format:check',
    'lint',
    'typecheck',
    'npm test',
    'test:coverage',
    'test:ui-parity',
  ]) {
    assert.match(gate, new RegExp(command.replace(':', '\\:')));
  }
  assert.equal(pkg.scripts.prepublishOnly, 'npm run test:gate');
});

test('quality gate runs on Linux and Windows and cancels superseded runs', () => {
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /ubuntu-latest/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /actions\/checkout@v7/);
  assert.match(workflow, /actions\/setup-node@v7/);
  assert.match(workflow, /node-version:\s*24/);
  assert.match(workflow, /cancel-in-progress:\s*true/);
  assert.match(workflow, /playwright install --with-deps chromium/);
  assert.match(workflow, /npm run test:gate/);
  assert.doesNotMatch(workflow, /ci-skip|Exclude unchanged|mv packages\/executor\/test/);
});

test('node coverage batches tests, merges one complete V8 report, and requires 85 percent', () => {
  assert.match(coverageRunner, /TEST_BATCH_SIZE\s*=\s*20/);
  assert.match(coverageRunner, /NODE_V8_COVERAGE/);
  assert.match(coverageRunner, /toolEntries\.c8,\s*'report'/s);
  assert.match(coverageRunner, /--check-coverage/);
  for (const metric of ['--lines', '--statements', '--functions', '--branches']) {
    assert.match(coverageRunner, new RegExp(`${metric}',\\s*'85'`));
  }
  assert.match(gitignore, /^\.coverage-v8\/$/m);
});

test('release workflow triggers on v* tags and manual dispatch with npm trusted publishing', () => {
  const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8');
  assert.match(releaseWorkflow, /tags:\s*\n\s*-\s*['"]v\*\.\*\.\*['"]/);
  assert.match(releaseWorkflow, /workflow_dispatch:/);
  assert.match(releaseWorkflow, /actions\/checkout@v7/);
  assert.match(releaseWorkflow, /actions\/setup-node@v7/);
  assert.match(releaseWorkflow, /node-version:\s*24/);
  assert.match(releaseWorkflow, /id-token:\s*write/);
  assert.match(releaseWorkflow, /npm publish --provenance --access public/);
});
