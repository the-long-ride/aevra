import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gitAdd, gitCommit, gitStatus } from '../src/git.js';

function git(cwd: string, ...args: string[]) {
  return execFileSync(
    'git',
    ['-c', 'user.name=Sample', '-c', 'user.email=sample@example.test', '-c', 'commit.gpgsign=false', ...args],
    { cwd, stdio: ['ignore', 'pipe', 'pipe'] },
  ).toString();
}

function repo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-git-br-'));
  git(dir, 'init', '-q');
  mkdirSync(path.join(dir, 'config'));
  writeFileSync(path.join(dir, 'config', '.env.local'), 'NAME=sample value\n');
  writeFileSync(path.join(dir, 'keep.txt'), 'keep words\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'seed');
  return dir;
}

test('gitAdd stages files and gitCommit ignores unstaged or untracked SECRET changes', async () => {
  const dir = repo();
  try {
    writeFileSync(path.join(dir, 'config', '.env.local'), 'NAME=changed value\n');
    writeFileSync(path.join(dir, 'new.txt'), 'new words\n');
    const added = await gitAdd(dir);
    // With no pathspec git stages nothing, so the SECRET change stays unstaged.
    assert.equal(added.exitCode, 0);
    assert.match((await gitStatus(dir)).stdout, /^ M config\/\.env\.local$/m);
    // Nothing is staged: the SECRET modification is unstaged, new.txt untracked.
    const result = await gitCommit(dir, 'no staged work');
    assert.notEqual(result.exitCode, 0);
    assert.match((await gitStatus(dir)).stdout, /\?\? new\.txt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gitCommit with -a or --all refuses a modified SECRET file', async () => {
  const dir = repo();
  try {
    writeFileSync(path.join(dir, 'config', '.env.local'), 'NAME=changed value\n');
    for (const flag of ['-a', '--all']) {
      await assert.rejects(
        () => gitCommit(dir, 'include unstaged', [flag]),
        (error: any) =>
          error.code === 'SECURITY_VIOLATION' && /config\/\.env\.local/.test(error.message),
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gitCommit checks the destination of a staged rename', async () => {
  const dir = repo();
  try {
    const staged = await gitAdd(dir, ['keep.txt']);
    assert.equal(staged.exitCode, 0);
    git(dir, 'mv', 'keep.txt', '.env');
    await assert.rejects(() => gitCommit(dir, 'rename'), /Cannot commit SECRET file .*: \.env$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
