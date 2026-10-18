import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { markStateDirectory, purgeStateDirectory } from '../src/cleanup.js';

test('purge requires exact product ownership and refuses home, repository and shared state', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'aevra-purge-'));
  const root = path.join(home, 'root'),
    browser = path.join(home, 'browser');
  try {
    mkdirSync(root);
    mkdirSync(browser);
    assert.throws(() => purgeStateDirectory(root, 'aevra', home), /OWNERSHIP/);
    markStateDirectory(root, 'aevra', home);
    markStateDirectory(browser, 'aevra-browser', home);
    writeFileSync(path.join(root, 'state.db'), 'data');
    assert.throws(() => markStateDirectory(root, 'aevra-browser', home), /OWNERSHIP/);
    assert.throws(() => markStateDirectory(home, 'aevra', home), /UNSAFE/);
    mkdirSync(path.join(root, '.git'));
    assert.throws(() => purgeStateDirectory(root, 'aevra', home), /UNSAFE/);
    rmSync(path.join(root, '.git'), { recursive: true });
    purgeStateDirectory(root, 'aevra', home);
    assert.equal(existsSync(root), false);
    assert.equal(existsSync(browser), true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
