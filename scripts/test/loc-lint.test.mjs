import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const lintScript = fileURLToPath(new URL('../loc-lint.mjs', import.meta.url));

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

test('LOC lint reports tracked oversized source with its configured limit', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'aevra-loc-'));
  mkdirSync(path.join(cwd, 'src'));
  writeFileSync(path.join(cwd, 'src', 'big.js'), 'const x = 1;\n'.repeat(351));
  runGit(cwd, ['init', '-q']);
  runGit(cwd, ['add', 'src/big.js']);

  const result = spawnSync(process.execPath, [lintScript], {
    cwd,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /src\/big\.js: 351 lines \(limit 350\)/);
});

test('LOC lint ignores untracked and generated source', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'aevra-loc-'));
  mkdirSync(path.join(cwd, 'src'));
  mkdirSync(path.join(cwd, 'dist'));
  writeFileSync(path.join(cwd, 'src', 'ok.ts'), 'export const ok = true;\n');
  writeFileSync(path.join(cwd, 'src', 'untracked.js'), 'const x = 1;\n'.repeat(351));
  writeFileSync(path.join(cwd, 'dist', 'generated.js'), 'const x = 1;\n'.repeat(351));
  runGit(cwd, ['init', '-q']);
  runGit(cwd, ['add', 'src/ok.ts', 'dist/generated.js']);

  const result = spawnSync(process.execPath, [lintScript], {
    cwd,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /lint:loc ok/);
});
