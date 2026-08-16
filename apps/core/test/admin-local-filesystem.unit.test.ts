import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LocalFilesystemService } from '../src/admin/local-filesystem.js';

test('directory listing requires an absolute path and returns one sorted directory level only', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aevra-directory-list-'));
  try {
    mkdirSync(path.join(root, 'zeta'));
    mkdirSync(path.join(root, 'Alpha'));
    mkdirSync(path.join(root, 'Alpha', 'nested'));
    writeFileSync(path.join(root, 'file.txt'), 'x');
    const service = new LocalFilesystemService();

    await assert.rejects(
      () => service.listDirectories('relative/path'),
      (error: any) => {
        assert.equal(error.code, 'INVALID_DIRECTORY_PATH');
        return true;
      },
    );

    const result = await service.listDirectories(root);
    assert.equal(result.path, await service.canonicalDirectory(root));
    assert.deepEqual(
      result.directories.map((entry) => entry.name),
      ['Alpha', 'zeta'],
    );
    assert.equal(
      result.directories.some((entry) => entry.name === 'nested'),
      false,
    );
    assert.equal(
      result.directories.some((entry) => entry.name === 'file.txt'),
      false,
    );
    assert.equal(
      result.parent,
      path.dirname(result.path) === result.path ? null : path.dirname(result.path),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('directory listing is bounded and maps missing or unreadable paths to stable errors', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aevra-directory-bound-'));
  try {
    for (let index = 0; index < 250; index++) mkdirSync(path.join(root, `dir-${index}`));
    const service = new LocalFilesystemService();
    const result = await service.listDirectories(root);
    assert.ok(result.directories.length <= 200);

    await assert.rejects(
      () => service.listDirectories(path.join(root, 'missing')),
      (error: any) => {
        assert.equal(error.code, 'DIRECTORY_NOT_FOUND');
        return true;
      },
    );

    const unreadable = new LocalFilesystemService({
      fs: {
        realpath: async (value: string) => value,
        stat: async () => ({ isDirectory: () => true }),
        readdir: async () => {
          throw Object.assign(new Error('denied'), { code: 'EACCES' });
        },
      } as any,
    });
    await assert.rejects(
      () => unreadable.listDirectories(path.resolve(root)),
      (error: any) => {
        assert.equal(error.code, 'DIRECTORY_NOT_READABLE');
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('native folder picker distinguishes selected cancelled and unavailable without a shell', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aevra-picker-'));
  try {
    const calls: Array<{ file: string; args: string[] }> = [];
    const selected = new LocalFilesystemService({
      platform: 'linux',
      runner: async (file, args) => {
        calls.push({ file, args });
        return { code: 0, stdout: `${root}\n`, stderr: '' };
      },
    });
    assert.deepEqual(await selected.pickServerFolder(), {
      status: 'selected',
      path: await selected.canonicalDirectory(root),
    });
    assert.equal(calls[0]?.file, 'zenity');
    assert.deepEqual(calls[0]?.args, [
      '--file-selection',
      '--directory',
      '--title=Select Aevra workspace',
    ]);

    const cancelled = new LocalFilesystemService({
      platform: 'darwin',
      runner: async () => ({ code: 1, stdout: '', stderr: 'User canceled.' }),
    });
    await assert.rejects(
      () => cancelled.pickServerFolder(),
      (error: any) => {
        assert.equal(error.code, 'NATIVE_PICKER_CANCELLED');
        return true;
      },
    );

    const unavailable = new LocalFilesystemService({
      platform: 'linux',
      runner: async () => {
        throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      },
    });
    await assert.rejects(
      () => unavailable.pickServerFolder(),
      (error: any) => {
        assert.equal(error.code, 'NATIVE_PICKER_UNAVAILABLE');
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Linux native picker falls back to kdialog when zenity is not installed', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aevra-picker-fallback-'));
  try {
    const calls: string[] = [];
    const service = new LocalFilesystemService({
      platform: 'linux',
      runner: async (file) => {
        calls.push(file);
        if (file === 'zenity') throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return { code: 0, stdout: `${root}\n`, stderr: '' };
      },
    });

    assert.deepEqual(await service.pickServerFolder(), {
      status: 'selected',
      path: await service.canonicalDirectory(root),
    });
    assert.deepEqual(calls, ['zenity', 'kdialog']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
