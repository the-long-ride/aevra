import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  markStateDirectory,
  prepareStatePurge,
  purgeStateDirectory,
  tryMarkStateDirectory,
} from '../src/cleanup.js';
import { claimExtension, releaseExtension } from '../src/shared-extension.js';
import { acquireIntegrationLock, integrationLockPath } from '../src/lock.js';

function scratch(run: (home: string) => void) {
  // Real path: purge reports canonical paths, and macOS tmpdir() is a link (/var -> /private/var).
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), 'aevra-state-')));
  try {
    run(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function extension(parent: string) {
  mkdirSync(path.join(parent, 'aevra-extension'), { recursive: true });
  writeFileSync(path.join(parent, 'aevra-extension/manifest.json'), '{}');
}

test('a state folder reached through a linked parent can be marked and purged', () => {
  scratch((home) => {
    const real = path.join(home, 'real');
    mkdirSync(real);
    const linked = path.join(home, 'linked');
    symlinkSync(real, linked, process.platform === 'win32' ? 'junction' : 'dir');
    const state = path.join(linked, 'state');
    markStateDirectory(state, 'aevra', home);
    writeFileSync(path.join(state, 'aevra.db'), 'plain test phrase');
    markStateDirectory(state, 'aevra', home);
    assert.equal(purgeStateDirectory(state, 'aevra', home).removed, true);
    assert.equal(existsSync(path.join(real, 'state')), false);
  });
});

test('startup marking reports a problem instead of throwing', () => {
  scratch((home) => {
    const state = path.join(home, 'state');
    markStateDirectory(state, 'aevra-browser', home);
    assert.match(tryMarkStateDirectory(state, 'aevra', home) ?? '', /OWNERSHIP_CONFLICT/);
    assert.match(tryMarkStateDirectory(home, 'aevra', home) ?? '', /UNSAFE/);
    assert.equal(tryMarkStateDirectory(state, 'aevra-browser', home), null);
  });
});

test('purge of a folder that already held user files deletes only what came later', () => {
  scratch((home) => {
    const state = path.join(home, 'documents');
    mkdirSync(state);
    writeFileSync(path.join(state, 'notes.txt'), 'keep these words');
    markStateDirectory(state, 'aevra-browser', home);
    writeFileSync(path.join(state, 'pairings.json'), '{}');
    mkdirSync(path.join(state, 'agent-credentials'));
    const result = purgeStateDirectory(state, 'aevra-browser', home);
    assert.equal(result.removed, false);
    assert.deepEqual(result.retained, [path.join(state, 'notes.txt')]);
    assert.ok(existsSync(path.join(state, 'notes.txt')));
    assert.ok(!existsSync(path.join(state, 'pairings.json')));
    assert.ok(!existsSync(path.join(state, 'agent-credentials')));
    assert.ok(!existsSync(path.join(state, '.aevra-state-owner.json')));
  });
});

test('the default state folder is owned even when it already holds files', () => {
  scratch((home) => {
    const state = path.join(home, 'Aevra');
    mkdirSync(state);
    writeFileSync(path.join(state, 'aevra.db'), 'older install data');
    markStateDirectory(state, 'aevra', home, true);
    assert.equal(purgeStateDirectory(state, 'aevra', home).removed, true);
  });
});

test('purge keeps a shared extension inside the state folder that the other product owns', () => {
  scratch((home) => {
    const state = path.join(home, 'browser-state');
    markStateDirectory(state, 'aevra-browser', home);
    const parent = path.join(state, 'extension');
    extension(parent);
    claimExtension(home, 'aevra-browser', parent);
    claimExtension(home, 'aevra', parent);
    writeFileSync(path.join(state, 'daemon.lock'), 'x');
    const purge = prepareStatePurge(state, 'aevra-browser', home);
    const released = releaseExtension(home, 'aevra-browser', true);
    assert.equal(released.retained, path.join(parent, 'aevra-extension'));
    const result = purge.run([released.retained!]);
    assert.ok(existsSync(path.join(parent, 'aevra-extension/manifest.json')));
    assert.ok(!existsSync(path.join(state, 'daemon.lock')));
    assert.deepEqual(result.retained, [path.join(parent, 'aevra-extension')]);
    assert.equal(releaseExtension(home, 'aevra', true).removed, true);
  });
});

test('extension ownership changes wait for the shared integration lock', () => {
  scratch((home) => {
    const parent = path.join(home, 'shared');
    extension(parent);
    const release = acquireIntegrationLock(integrationLockPath(home));
    try {
      assert.throws(() => claimExtension(home, 'aevra', parent), /AGENT_INSTALL_BUSY/);
      assert.throws(() => releaseExtension(home, 'aevra', false), /AGENT_INSTALL_BUSY/);
    } finally {
      release();
    }
    claimExtension(home, 'aevra', parent);
    assert.ok(!existsSync(integrationLockPath(home)));
  });
});

test('a lock left by a process that has exited is taken over, a live one is not', () => {
  scratch((home) => {
    const lock = integrationLockPath(home);
    mkdirSync(path.dirname(lock), { recursive: true });
    const gone = spawnSync(process.execPath, ['-e', '']).pid;
    writeFileSync(lock, JSON.stringify({ pid: gone }));
    acquireIntegrationLock(lock)();
    writeFileSync(lock, JSON.stringify({ pid: process.pid }));
    assert.throws(
      () => acquireIntegrationLock(lock),
      (error: Error) => error.message.includes(lock),
    );
  });
});
