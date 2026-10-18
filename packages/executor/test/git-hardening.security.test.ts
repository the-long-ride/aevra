import { linkSync } from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gitStatus, gitDiff, gitLog, gitBranch, gitCommit } from '../src/git.js';
import { resolveExecutable } from '../src/spawn-target.js';
import { classifySensitivity } from '../../security/src/sensitive.js';

function raw(cwd: string, ...args: string[]) {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=Sample',
      '-c',
      'user.email=sample@example.test',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd, stdio: ['ignore', 'pipe', 'pipe'] },
  ).toString();
}
function repo() {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'aevra-hardening-'));
  raw(cwd, 'init', '-q');
  writeFileSync(path.join(cwd, 'safe.txt'), 'ordinary first words');
  writeFileSync(path.join(cwd, '.env'), 'private first words');
  writeFileSync(path.join(cwd, 'private.txt'), 'protected first words');
  raw(cwd, 'add', '-A');
  raw(cwd, 'commit', '-qm', 'initial');
  return cwd;
}
const protectedGlobs = [{ glob: 'private.txt', class: 'SECRET' as const }];

test('read-only Git rejects mutation, host IO, executable options and escaping pathspecs', async () => {
  const cwd = repo();
  try {
    for (const args of [
      ['--output=outside.txt'],
      ['--no-index', 'safe.txt', 'private.txt'],
      ['--ext-diff'],
      ['--textconv'],
      ['-O', 'private.txt'],
      ['--', '../outside.txt'],
      ['--', ':(top)../outside.txt'],
    ]) {
      await assert.rejects(
        () => gitDiff(cwd, args),
        (e: any) => e.code === 'INVALID_REQUEST',
        args.join(' '),
      );
    }
    for (const args of [['-D', 'main'], ['surprise'], ['--set-upstream-to=origin/main']]) {
      await assert.rejects(
        () => gitBranch(cwd, args),
        (e: any) => e.code === 'INVALID_REQUEST',
      );
    }
    assert.equal(raw(cwd, 'branch', '--list', 'surprise'), '');
    assert.equal((await gitDiff(cwd, ['--stat', '--', 'safe.txt'])).exitCode, 0);
    assert.equal((await gitLog(cwd, ['--oneline', '-n', '1'])).exitCode, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('read-only Git cannot execute repository fsmonitor configuration', async () => {
  const cwd = repo();
  try {
    const marker = path.join(cwd, 'executed.txt').replaceAll('\\', '/');
    raw(cwd, 'config', 'core.fsmonitor', `echo executed > "${marker}"`);
    await gitStatus(cwd);
    assert.equal(existsSync(marker), false);
    assert.equal(classifySensitivity({ path: '/.git/config' }), 'SENSITIVE');
    assert.equal(classifySensitivity({ path: '/.git/hooks/pre-commit' }), 'SENSITIVE');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('Git diff and patch history exclude built-in and manifest-protected contents', async () => {
  const cwd = repo();
  try {
    writeFileSync(path.join(cwd, '.env'), 'private changed words');
    writeFileSync(path.join(cwd, 'private.txt'), 'protected changed words');
    writeFileSync(path.join(cwd, 'safe.txt'), 'ordinary changed words');
    const diff = await gitDiff(cwd, ['-p'], protectedGlobs);
    assert.doesNotMatch(
      diff.stdout,
      /private (first|changed) words|protected (first|changed) words/,
    );
    assert.match(diff.stdout, /ordinary changed words/);
    const log = await gitLog(cwd, ['-p'], protectedGlobs);
    assert.doesNotMatch(log.stdout, /private first words|protected first words/);
    assert.match(log.stdout, /ordinary first words/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('Git commit guards bundled all flags, explicit paths and manifest rules', async () => {
  const cwd = repo();
  try {
    writeFileSync(path.join(cwd, '.env'), 'private changed words');
    for (const args of [['-qa'], ['--', '.env']]) {
      await assert.rejects(
        () => gitCommit(cwd, 'guard words', args),
        (e: any) => e.code === 'SECURITY_VIOLATION',
      );
    }
    writeFileSync(path.join(cwd, 'private.txt'), 'protected changed words');
    raw(cwd, 'add', 'private.txt');
    await assert.rejects(
      () => gitCommit(cwd, 'guard words', [], protectedGlobs),
      (e: any) => e.code === 'SECURITY_VIOLATION',
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test(
  'Windows unresolved bare executables never fall back to the workspace',
  { skip: process.platform !== 'win32' },
  () => {
    assert.throws(
      () => resolveExecutable('unavailable-aevra-program', { PATH: '', PATHEXT: '.EXE' }),
      (e: any) => e.code === 'ENOENT',
    );
    assert.throws(
      () => resolveExecutable('unavailable-aevra-program.exe', { PATH: '' }),
      (e: any) => e.code === 'ENOENT',
    );
  },
);

test('Git diff refuses a hard-link alias of a protected file', async () => {
  const cwd = repo();
  try {
    linkSync(path.join(cwd, '.env'), path.join(cwd, 'alias.txt'));
    raw(cwd, 'add', 'alias.txt');
    const diff = await gitDiff(cwd, ['--cached']);
    assert.doesNotMatch(diff.stdout, /private first words/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('Git history excludes deleted sensitive files under every built-in spelling', async () => {
  const cwd = repo();
  try {
    for (const name of ['project.npmrc', 'project.pypirc', 'secrets.json.bak', 'prefixid_rsa'])
      writeFileSync(path.join(cwd, name), 'historical private words');
    raw(cwd, 'add', '-A');
    raw(cwd, 'commit', '-qm', 'sensitive history');
    raw(cwd, 'rm', 'project.npmrc', 'project.pypirc', 'secrets.json.bak', 'prefixid_rsa');
    raw(cwd, 'commit', '-qm', 'delete sensitive paths');
    assert.doesNotMatch((await gitLog(cwd, ['-p'])).stdout, /historical private words/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('Git commit refuses a staged hard-link alias of a SECRET file', async () => {
  const cwd = repo();
  try {
    linkSync(path.join(cwd, '.env'), path.join(cwd, 'alias.txt'));
    raw(cwd, 'add', 'alias.txt');
    await assert.rejects(() => gitCommit(cwd, 'ordinary message'), { code: 'SECURITY_VIOLATION' });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
