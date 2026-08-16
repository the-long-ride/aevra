import assert from 'node:assert/strict';
import test from 'node:test';
import { COMMAND_OUTPUT_LIMIT, runCommand } from '../src/commands.js';
test('command execution uses argv without shell expansion', async () => {
  const r = await runCommand({
    executable: process.execPath,
    args: ['-e', 'console.log(process.argv[1])', 'a;echo-pwn'],
    env: {},
  });
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /a;echo-pwn/);
});
test('command execution redacts injected environment secrets', async () => {
  const secret = 'super-secret-value-12345';
  const r = await runCommand({
    executable: process.execPath,
    args: ['-e', 'process.stdout.write(process.env.AEVRA_TEST_SECRET||"")'],
    env: { AEVRA_TEST_SECRET: secret },
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout.includes(secret), false);
  assert.match(r.stdout, /\[REDACTED\]/);
});
test('command output is bounded', async () => {
  const r = await runCommand({
    executable: process.execPath,
    args: ['-e', `process.stdout.write('x'.repeat(${COMMAND_OUTPUT_LIMIT}+1000))`],
    env: {},
  });
  assert.ok(r.stdout.length <= COMMAND_OUTPUT_LIMIT + 128);
  assert.match(r.stdout, /output truncated/i);
});
test('command timeout terminates a long-running child', async () => {
  const started = Date.now();
  const r = await runCommand({
    executable: process.execPath,
    args: ['-e', 'setTimeout(()=>{},5000)'],
    env: {},
    timeoutMs: 40,
  });
  assert.ok(Date.now() - started < 3000);
  assert.ok(
    r.signal !== null || r.exitCode !== 0,
    'timed out child must not report normal success',
  );

  const { appendCommandOutput } = await import('../src/commands.js');
  const atLimit = appendCommandOutput('x'.repeat(COMMAND_OUTPUT_LIMIT), 'more');
  assert.equal(atLimit.truncated, true);

  const nullChunk = appendCommandOutput('abc', undefined);
  assert.equal(nullChunk.value, 'abc');

  await assert.rejects(() =>
    runCommand({
      executable: '/nonexistent_executable_12345',
      args: [],
      env: {},
      timeoutMs: 5000,
    }),
  );
});
