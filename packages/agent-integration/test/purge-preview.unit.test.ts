import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { markStateDirectory, prepareStatePurge } from '../src/cleanup.js';
import {
  claimExtension,
  extensionClaimConflict,
  extensionModified,
  previewRelease,
  releaseExtension,
  releaseExtensionOrKeep,
} from '../src/shared-extension.js';

function home(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'aevra-preview-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('preview lists what a purge would remove and keep, changing nothing', (t) => {
  const h = home(t);
  const state = path.join(h, 'state');
  mkdirSync(state);
  writeFileSync(path.join(state, 'mine.txt'), 'theirs');
  markStateDirectory(state, 'aevra', h);
  writeFileSync(path.join(state, 'token.key'), 'plain words');
  mkdirSync(path.join(state, 'extension', 'aevra-extension'), { recursive: true });
  const keep = path.join(state, 'extension', 'aevra-extension');
  const preview = prepareStatePurge(state, 'aevra', h).preview([keep]);
  assert.deepEqual(preview.remove.map((file) => path.basename(file)).sort(), [
    'extension',
    'token.key',
  ]);
  assert.ok(preview.retained.some((file) => file.endsWith('mine.txt')));
  assert.ok(preview.retained.some((file) => file.endsWith('aevra-extension')));
  assert.ok(existsSync(path.join(state, 'token.key')));
});

test('a state folder moved elsewhere keeps its marker and can still be purged', (t) => {
  const h = home(t);
  const first = path.join(h, 'first');
  markStateDirectory(first, 'aevra', h, true);
  writeFileSync(path.join(first, 'data.txt'), 'words');
  const moved = path.join(h, 'moved');
  cpSync(first, moved, { recursive: true });
  markStateDirectory(moved, 'aevra', h);
  assert.equal(prepareStatePurge(moved, 'aevra', h).run().removed, true);
  assert.throws(() => markStateDirectory(first, 'aevra-browser', h), /STATE_OWNERSHIP_CONFLICT/);
});

test('a kept copy keeps its recorded hashes, so later edits are still detected', (t) => {
  const h = home(t);
  const parent = path.join(h, 'shared');
  const manifest = path.join(parent, 'aevra-extension', 'manifest.json');
  mkdirSync(path.dirname(manifest), { recursive: true });
  writeFileSync(manifest, '{"version":"1.3.0"}');
  claimExtension(h, 'aevra', parent);
  writeFileSync(manifest, '{"version":"1.3.0","edited":true}');
  assert.equal(extensionModified(h, parent), true);
  claimExtension(h, 'aevra-browser', parent, { rebaseline: false });
  assert.equal(extensionModified(h, parent), true);
  assert.match(extensionClaimConflict(h, path.join(h, 'elsewhere')) ?? '', /recorded at/);
  assert.equal(extensionClaimConflict(h, parent), null);
  assert.equal(previewRelease(h, 'aevra', true).retained, path.join(parent, 'aevra-extension'));
  releaseExtension(h, 'aevra', true);
  assert.throws(() => releaseExtension(h, 'aevra-browser', true), /user changes/);
  assert.match(readFileSync(manifest, 'utf8'), /edited/);
  // Uninstall keeps the edited copy and carries on, naming the folder it kept.
  const kept = releaseExtensionOrKeep(h, 'aevra-browser', true);
  assert.equal(kept.removed, false);
  assert.match(kept.message, /user changes/);
  assert.equal(kept.retained, path.join(parent, 'aevra-extension'));
});
