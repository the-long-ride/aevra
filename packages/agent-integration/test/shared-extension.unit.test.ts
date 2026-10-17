import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  sharedExtensionDirectory,
  claimExtension,
  releaseExtension,
} from '../src/shared-extension.js';

test('products reuse one stable extension directory and remove only the final owned copy', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'aevra-shared-ext-'));
  try {
    const parent = sharedExtensionDirectory(home, []);
    const folder = path.join(parent, 'aevra-extension');
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, 'manifest.json'), '{}');
    claimExtension(home, 'aevra', parent);
    assert.equal(sharedExtensionDirectory(home, []), parent);
    claimExtension(home, 'aevra-browser', parent);
    assert.equal(releaseExtension(home, 'aevra', true).removed, false);
    assert.ok(existsSync(folder));
    assert.equal(releaseExtension(home, 'aevra-browser', true).removed, true);
    assert.ok(!existsSync(folder));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
