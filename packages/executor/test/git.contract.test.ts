import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCommand } from '../src/commands.js';
import { gitStatus, gitDiff, gitLog, gitBranch, gitCommit, gitPush } from '../src/git.js';

test('git status primitive runs in supplied workspace', async () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'aevra-git-'));
  await runCommand({ executable: 'git', args: ['init'], env: {} }, d);
  await runCommand({ executable: 'git', args: ['config', 'user.name', 'Tester'], env: {} }, d);
  await runCommand(
    { executable: 'git', args: ['config', 'user.email', 'test@example.com'], env: {} },
    d,
  );

  const r = await gitStatus(d);
  assert.equal(r.exitCode, 0);

  writeFileSync(path.join(d, 'file.txt'), 'hello');
  await runCommand({ executable: 'git', args: ['add', 'file.txt'], env: {} }, d);

  const diff = await gitDiff(d, ['--cached']);
  assert.equal(diff.exitCode, 0);
  const diffDefault = await gitDiff(d);
  assert.equal(diffDefault.exitCode, 0);

  const commit = await gitCommit(d, 'initial commit');
  assert.equal(commit.exitCode, 0);

  const log = await gitLog(d);
  assert.equal(log.exitCode, 0);

  const branch = await gitBranch(d);
  assert.equal(branch.exitCode, 0);

  // Push argument variants
  await gitPush(d);
  await gitPush(d, 'origin');
  await gitPush(d, undefined, 'main');
  const push = await gitPush(d, 'origin', 'main');
  assert.ok(push);

  // Safety check: committing SECRET files is rejected
  writeFileSync(path.join(d, '.env'), 'SECRET_API_KEY=12345');
  await runCommand({ executable: 'git', args: ['add', '.env'], env: {} }, d);

  await assert.rejects(
    () => gitCommit(d, 'commit secret file'),
    (err: any) => err.code === 'SECURITY_VIOLATION' && err.message.includes('.env'),
  );
});
