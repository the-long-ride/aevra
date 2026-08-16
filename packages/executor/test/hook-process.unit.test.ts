import assert from 'node:assert/strict';
import test from 'node:test';
import { runHookProcess } from '../src/hook-process.js';

test('hook runner passes event payload over stdin and environment', async () => {
  const script = [
    "let input=''",
    "process.stdin.setEncoding('utf8')",
    "process.stdin.on('data', value => input += value)",
    "process.stdin.on('end', () => {",
    '  const body=JSON.parse(input)',
    '  process.stdout.write(JSON.stringify({event:process.env.AEVRA_HOOK_EVENT,value:body.payload.value}))',
    '})',
  ].join(';');
  const result = (await runHookProcess({
    kind: 'hook.run',
    event: 'before_tool_call',
    hookKind: 'test',
    executable: process.execPath,
    args: ['-e', script],
    env: {},
    timeoutMs: 3000,
    execution: 'run',
    context: { sessionId: 's' },
    payload: { value: 42 },
  })) as any;
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), { event: 'before_tool_call', value: 42 });
});

test('hook runner handles launch mode timeout and empty executable validation', async () => {
  await assert.rejects(
    () =>
      runHookProcess({
        kind: 'hook.run',
        event: 'test',
        hookKind: 'test',
        executable: '   ',
        args: [],
        env: {},
        timeoutMs: 1000,
        execution: 'run',
        context: {},
        payload: {},
      }),
    /Hook executable is required/,
  );

  const launched = (await runHookProcess({
    kind: 'hook.run',
    event: 'test',
    hookKind: 'test',
    executable: process.execPath,
    args: ['-e', 'process.exit(0)'],
    env: {},
    timeoutMs: 1000,
    execution: 'launch',
    context: {},
    payload: {},
  })) as any;
  assert.equal(launched.launched, true);
  assert.ok(launched.pid > 0);

  const timedOut = (await runHookProcess({
    kind: 'hook.run',
    event: 'test',
    hookKind: 'test',
    executable: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 5000)'],
    env: {},
    timeoutMs: 50,
    execution: 'run',
    context: {},
    payload: {},
  })) as any;
  assert.equal(timedOut.timedOut, true);

  // Stderr capture
  const withStderr = (await runHookProcess({
    kind: 'hook.run',
    event: 'test',
    hookKind: 'test',
    executable: process.execPath,
    args: ['-e', "process.stderr.write('hook-warning')"],
    env: {},
    timeoutMs: 1000,
    execution: 'run',
    context: {},
    payload: {},
  })) as any;
  assert.equal(withStderr.stderr, 'hook-warning');

  // Spawn failure rejection
  await assert.rejects(() =>
    runHookProcess({
      kind: 'hook.run',
      event: 'test',
      hookKind: 'test',
      executable: '/nonexistent_hook_bin_123',
      args: [],
      env: {},
      timeoutMs: 1000,
      execution: 'run',
      context: {},
      payload: {},
    }),
  );
});
