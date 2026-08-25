import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const workflow = readFileSync('.github/workflows/quality-gate.yml', 'utf8');
const coverageRunner = readFileSync('scripts/test-coverage-node.mjs', 'utf8');
const gitignore = readFileSync('.gitignore', 'utf8');

test('full repository gate runs each expensive validation path once', () => {
  const gate = pkg.scripts['test:gate'];
  for (const command of [
    'format:check',
    'lint',
    'typecheck',
    'test:scripts',
    'test:coverage',
    'npm run build',
    'test:ui-parity:only',
  ]) {
    assert.match(gate, new RegExp(command.replace(':', '\\:')));
  }
  assert.doesNotMatch(gate, /npm test(?:\s|$)/);
  assert.equal(pkg.scripts['test:scripts'], 'node scripts/test.mjs scripts');
  assert.equal(pkg.scripts['test:ui-parity:only'], 'playwright test');
  assert.match(pkg.scripts['test:ui-parity'], /npm run build/);
  assert.match(pkg.scripts['test:ui-parity'], /test:ui-parity:only/);
  assert.equal(pkg.scripts.prepack, 'npm run build');
  assert.equal(pkg.scripts.prepare, undefined);
  assert.equal(pkg.scripts.prepublishOnly, undefined);
});

test('quality gate parallelizes Linux validation and keeps a Windows portability gate', () => {
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /ubuntu-latest/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /static-checks:/);
  assert.match(workflow, /node-coverage:/);
  assert.match(workflow, /web-coverage:/);
  assert.match(workflow, /browser-parity:/);
  assert.match(workflow, /windows-portability:/);
  assert.match(workflow, /actions\/checkout@v7/);
  assert.match(workflow, /actions\/setup-node@v7/);
  assert.match(workflow, /node-version:\s*24/);
  assert.match(workflow, /cancel-in-progress:\s*true/);
  assert.match(workflow, /npm ci --ignore-scripts/);
  assert.match(workflow, /npm run test:scripts/);
  assert.match(workflow, /npm run test:coverage:node/);
  assert.match(workflow, /npm run test:coverage:web/);
  assert.match(workflow, /npm run test:ui-parity:only/);
  assert.match(workflow, /npm run test:portability/);
  assert.match(workflow, /playwright install --with-deps chromium/);
  assert.doesNotMatch(workflow, /npm run test:gate/);
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

test('release publishes only an exact SHA already validated by the quality workflow', () => {
  const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8');
  assert.match(releaseWorkflow, /tags:\s*\n\s*-\s*['"]v\*\.\*\.\*['"]/);
  assert.match(releaseWorkflow, /workflow_dispatch:/);
  assert.match(releaseWorkflow, /actions\/checkout@v7/);
  assert.match(releaseWorkflow, /actions\/setup-node@v7/);
  assert.match(releaseWorkflow, /node-version:\s*24/);
  assert.match(releaseWorkflow, /id-token:\s*write/);
  assert.match(releaseWorkflow, /actions:\s*read/);
  assert.match(releaseWorkflow, /quality-gate\.yml\/runs/);
  assert.match(releaseWorkflow, /head_sha=.*RELEASE_SHA/);
  assert.match(releaseWorkflow, /conclusion\s*==\s*['"]success['"]/);
  assert.match(releaseWorkflow, /event\s*==\s*['"]push['"]/);
  assert.match(releaseWorkflow, /npm ci --ignore-scripts/);
  assert.match(releaseWorkflow, /npm publish --provenance --access public/);
  assert.doesNotMatch(releaseWorkflow, /playwright install/);
  assert.doesNotMatch(releaseWorkflow, /npm run test:gate/);
  assert.doesNotMatch(releaseWorkflow, /npm run build/);
});
