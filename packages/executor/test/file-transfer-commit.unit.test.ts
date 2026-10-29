import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { commitTransfer } from '../src/file-transfer.js';

test('a failing temp cleanup after a successful link does not turn into FILE_EXISTS', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-commit-'));
  try {
    const temp = path.join(dir, 'a.tmp');
    const target = path.join(dir, 'a.bin');
    writeFileSync(temp, 'written words');
    await commitTransfer(temp, target, false, async () => {
      throw new Error('cleanup failed');
    });
    assert.equal(readFileSync(target, 'utf8'), 'written words');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a no-overwrite commit onto an existing target is still FILE_EXISTS', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-commit-'));
  try {
    const temp = path.join(dir, 'a.tmp');
    const target = path.join(dir, 'a.bin');
    writeFileSync(temp, 'new words');
    writeFileSync(target, 'old words');
    await assert.rejects(commitTransfer(temp, target, false), { code: 'FILE_EXISTS' });
    assert.equal(readFileSync(target, 'utf8'), 'old words');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
