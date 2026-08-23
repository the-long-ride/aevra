import assert from 'node:assert/strict';
import test from 'node:test';
import { runHookProcess } from '../src/hook-process.js';

test('hook runner passes event payload over stdin and environment', async () => {
  const script = [
    "let input=''",
    "process.stdin.setEncoding('utf8')",
    "process.stdin.on('data', value => input += value)",
    "process.stdin.on('end', () => {",
    "  const body=JSON.parse(input)",
    "  process.stdout.write(JSON.stringify({event:process.env.AEVRA_HOOK_EVENT,value:body.payload.value}))",
    '})',
  ].join(';');
  const result = await runHookProcess({
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
  }) as any;
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), { event: 'before_tool_call', value: 42 });
});
