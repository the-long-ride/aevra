import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('CLI executes when launched through a linked package path', () => {
  const compiledRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const temp = mkdtempSync(path.join(os.tmpdir(), 'aevra-link-'));
  const linkedRoot = path.join(temp, 'aevra');
  try {
    symlinkSync(compiledRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
    const cliPath = path.join(linkedRoot, 'apps', 'cli', 'src', 'cli.js');
    const result = spawnSync(process.execPath, [cliPath, '--help'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage:/);

    const shortHelpResult = spawnSync(process.execPath, [cliPath, '-h'], { encoding: 'utf8' });
    assert.equal(shortHelpResult.status, 0, shortHelpResult.stderr);
    assert.match(shortHelpResult.stdout, /Usage:/);

    const versionResult = spawnSync(process.execPath, [cliPath, '--version'], { encoding: 'utf8' });
    assert.equal(versionResult.status, 0, versionResult.stderr);
    assert.equal(versionResult.stdout.trim(), '1.0.4');

    const shortVersionResult = spawnSync(process.execPath, [cliPath, '-v'], { encoding: 'utf8' });
    assert.equal(shortVersionResult.status, 0, shortVersionResult.stderr);
    assert.equal(shortVersionResult.stdout.trim(), '1.0.4');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
