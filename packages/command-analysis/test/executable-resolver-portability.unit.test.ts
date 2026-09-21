import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  normalizeEnvKeys,
  resolveExecutableIdentity,
  resolveExecutablePath,
} from '../src/executable-resolver.js';

const platform = process.platform;
const isWindows = platform === 'win32';

function tempPath(prefix: string): string {
  return path.join(tmpdir(), prefix + '-' + Date.now());
}

test('normalizes environment keys by platform', () => {
  const sameWindowsPath = { Path: 'one', PATH: 'one', OMIT: undefined };
  assert.deepEqual(normalizeEnvKeys(sameWindowsPath, 'win32'), { PATH: 'one' });

  const conflictingWindowsPath = { Path: 'one', PATH: 'two' };
  assert.throws(
    () => normalizeEnvKeys(conflictingWindowsPath, 'win32'),
    /Conflicting environment variable casing/,
  );

  const posixPath = { Path: 'one', PATH: 'two', OMIT: undefined };
  assert.deepEqual(normalizeEnvKeys(posixPath, 'linux'), {
    Path: 'one',
    PATH: 'two',
  });
});

test('resolves explicit and PATH executables', () => {
  const tempDir = tempPath('aevra-executable-path');
  const binDir = path.join(tempDir, 'bin-search');
  mkdirSync(binDir, { recursive: true });

  const filename = isWindows ? 'fixture.EXE' : 'fixture';
  const executable = path.join(binDir, filename);
  writeFileSync(executable, 'fixture');

  const directoryName = isWindows ? 'directory-tool.EXE' : 'directory-tool';
  mkdirSync(path.join(binDir, directoryName), { recursive: true });

  const env = {
    PATH: binDir,
    ...(isWindows ? { PATHEXT: '.EXE' } : {}),
  };

  try {
    assert.equal(resolveExecutablePath(executable, {}, platform), executable);
    assert.equal(resolveExecutablePath('fixture', env, platform, tempDir), executable);
    assert.equal(resolveExecutablePath('directory-tool', env, platform), null);
    assert.equal(resolveExecutablePath('__missing_tool__', {}, platform), null);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('classifies executable identity provenance and launchers', async () => {
  const tempDir = tempPath('aevra-executable-identity');
  const outsideDir = tempPath('aevra-executable-outside');
  mkdirSync(tempDir, { recursive: true });
  mkdirSync(outsideDir, { recursive: true });

  const plain = path.join(tempDir, 'plain-tool');
  const script = path.join(tempDir, isWindows ? 'script.ps1' : 'script.sh');
  const installedDir = path.join(tempDir, isWindows ? 'Program Files' : 'bin');
  const installed = path.join(installedDir, 'installed-tool');

  mkdirSync(installedDir, { recursive: true });
  writeFileSync(plain, 'plain');
  writeFileSync(script, 'script');
  writeFileSync(installed, 'installed');

  try {
    const operator = await resolveExecutableIdentity(plain, tempDir, {
      platform,
      env: {},
      backendId: 'custom-backend',
    });
    assert.equal(operator?.provenance, 'operator');
    assert.equal(operator?.launcher, 'native');
    assert.equal(operator?.backendId, 'custom-backend');

    const workspace = await resolveExecutableIdentity(plain, tempDir, {
      platform,
      env: {},
      workspaceRoots: [outsideDir, tempDir],
    });
    assert.equal(workspace?.provenance, 'workspace');

    const installedIdentity = await resolveExecutableIdentity(installed, tempDir, {
      platform,
      env: {},
    });
    assert.equal(installedIdentity?.provenance, 'installed');

    const scriptIdentity = await resolveExecutableIdentity(script, tempDir, {
      platform,
      env: {},
    });
    assert.equal(scriptIdentity?.launcher, 'script');

    const outsideWorkspace = await resolveExecutableIdentity(plain, tempDir, {
      platform,
      env: {},
      workspaceRoots: [outsideDir],
    });
    assert.equal(outsideWorkspace?.provenance, 'operator');

    const missing = await resolveExecutableIdentity('__missing_identity__', tempDir, {
      platform,
      env: {},
    });
    assert.equal(missing, null);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('classifies Windows cmd shims', async (t) => {
  if (!isWindows) {
    t.skip('Windows-only launcher classification');
    return;
  }

  const tempDir = tempPath('aevra-cmd-shim');
  mkdirSync(tempDir, { recursive: true });
  const shim = path.join(tempDir, 'fixture.cmd');
  writeFileSync(shim, '@echo off');

  try {
    const identity = await resolveExecutableIdentity(shim, tempDir, {
      platform: 'win32',
      env: {},
    });
    assert.equal(identity?.launcher, 'cmd-shim');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('covers resolver defaults and canonical workspace fallback branches', async () => {
  const tempDir = tempPath('aevra-executable-defaults');
  mkdirSync(tempDir, { recursive: true });
  const plain = path.join(tempDir, 'plain-tool');
  writeFileSync(plain, 'plain');

  try {
    const defaultIdentity = await resolveExecutableIdentity(process.execPath, process.cwd());
    assert.ok(defaultIdentity);
    assert.equal(defaultIdentity.backendId, 'host');

    const missingExplicit = path.join(tempDir, 'missing-tool');
    assert.equal(resolveExecutablePath(missingExplicit, {}, platform), null);

    const withMissingRoot = await resolveExecutableIdentity(plain, tempDir, {
      platform,
      env: {},
      workspaceRoots: [path.join(tempDir, 'missing-root'), tempDir],
    });
    assert.equal(withMissingRoot?.provenance, 'workspace');

    const exactRoot = await resolveExecutableIdentity(plain, tempDir, {
      platform,
      env: {},
      workspaceRoots: [plain],
    });
    assert.equal(exactRoot?.provenance, 'workspace');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
