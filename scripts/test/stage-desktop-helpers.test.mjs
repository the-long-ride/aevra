import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('stages platform helper artifacts for npm and uniquely named release assets', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aevra-helper-stage-'));
  try {
    const source = path.join(root, 'source');
    const packaged = path.join(root, 'packaged');
    const release = path.join(root, 'release');
    for (const [slug, binary] of [
      ['linux-x64', 'aevra-desktop-helper'],
      ['win32-x64', 'aevra-desktop-helper.exe'],
    ]) {
      const dir = path.join(source, `desktop-helper-${slug}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, binary), slug);
    }

    const result = spawnSync(
      process.execPath,
      ['scripts/stage-desktop-helpers.mjs', source, packaged, release],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(path.join(packaged, 'linux-x64', 'aevra-desktop-helper'), 'utf8'),
      'linux-x64',
    );
    assert.equal(
      readFileSync(path.join(packaged, 'win32-x64', 'aevra-desktop-helper.exe'), 'utf8'),
      'win32-x64',
    );
    assert.equal(
      readFileSync(path.join(release, 'aevra-desktop-helper-linux-x64'), 'utf8'),
      'linux-x64',
    );
    assert.equal(
      readFileSync(path.join(release, 'aevra-desktop-helper-win32-x64.exe'), 'utf8'),
      'win32-x64',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
