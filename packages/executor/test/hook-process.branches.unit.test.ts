import assert from 'node:assert/strict';
import test from 'node:test';
import { runHookProcess } from '../src/hook-process.js';

function op(args: string[], extra: Record<string, unknown> = {}) {
  return {
    kind: 'hook.run' as const,
    event: 'after_tool_call',
    hookKind: 'test',
    executable: process.execPath,
    args,
    env: {},
    timeoutMs: 10_000,
    execution: 'run' as const,
    context: {},
    payload: {},
    ...extra,
  } as any;
}

test('hook output is capped at 128 KiB per stream', async () => {
  const script = "process.stdout.write('o'.repeat(200000)); process.stderr.write('e'.repeat(200000));";
  const result = (await runHookProcess(op(['-e', script]))) as any;
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.length, 128 * 1024);
  assert.equal(result.stderr.length, 128 * 1024);
  assert.equal(result.timedOut, false);
});

test('a hook that outlives its timeout is terminated and flagged', async () => {
  const result = (await runHookProcess(
    op(['-e', 'setTimeout(() => {}, 20000)'], { timeoutMs: 200 }),
  )) as any;
  assert.equal(result.timedOut, true);
  assert.equal(result.signal, 'SIGTERM');
});

test('a run-mode hook whose executable is missing rejects', async () => {
  await assert.rejects(
    () => runHookProcess(op([], { executable: 'aevra-no-such-hook' })),
    /ENOENT/,
  );
});
