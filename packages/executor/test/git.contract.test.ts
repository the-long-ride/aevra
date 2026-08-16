import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCommand } from '../src/commands.js';
import { gitStatus } from '../src/git.js';
test('git status primitive runs in supplied workspace', async () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'aevra-git-'));
  await runCommand({ executable: 'git', args: ['init'], env: {} }, d);
  const r = await gitStatus(d);
  assert.equal(r.exitCode, 0);
});
