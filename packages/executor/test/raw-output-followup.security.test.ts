import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitCommit, gitDiff } from '../src/git.js';
import { runCommand, COMMAND_OUTPUT_LIMIT } from '../src/commands.js';

test('raw security enumeration refuses incomplete successful child output', async () => {
  const input = {
    executable: process.execPath,
    args: ['-e', `process.stdout.write('a'.repeat(${COMMAND_OUTPUT_LIMIT + 1}))`],
    env: {},
    cwdLogical: '/',
  };
  await assert.rejects(runCommand(input, undefined, { rawOutput: true }), {
    code: 'SECURITY_VIOLATION',
  });
  const visible = await runCommand(input);
  assert.equal(visible.exitCode, 0);
  assert.match(visible.stdout, /output truncated/);
});

test('Git commit and protected reads refuse an oversized index before using partial names', async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'aevra-index-boundary-'));
  const raw = (args: string[], input?: string) =>
    execFileSync('git', args, { cwd, input, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  try {
    raw(['init', '-q']);
    const blob = raw(['hash-object', '-w', '--stdin'], 'fixture content').trim();
    const names = Array.from(
      { length: 6000 },
      (_, i) => `a${String(i).padStart(5, '0')}-${'x'.repeat(175)}`,
    );
    names.push('z/.env');
    raw(
      ['update-index', '--index-info'],
      names.map((name) => `100644 ${blob}\t${name}\n`).join(''),
    );
    assert.ok(raw(['ls-files', '-z']).length > COMMAND_OUTPUT_LIMIT);
    await assert.rejects(gitCommit(cwd, 'must not commit'), { code: 'SECURITY_VIOLATION' });
    await assert.rejects(gitDiff(cwd, ['--cached']), { code: 'SECURITY_VIOLATION' });
    assert.throws(() => raw(['rev-parse', '--verify', 'HEAD']));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
