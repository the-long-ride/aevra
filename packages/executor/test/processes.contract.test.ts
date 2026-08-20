import assert from 'node:assert/strict';
import test from 'node:test';
import { BoundedLog, ManagedProcessRuntime, verifyReAdoption } from '../src/processes.js';

test('bounded log evicts oldest lines', () => {
  const l = new BoundedLog(2);
  l.append('a\nb\nc\n');
  assert.deepEqual(l.read().lines, ['b', 'c']);
});

test('managed process reports completed terminal state and exit code', async () => {
  const runtime = new ManagedProcessRuntime();
  const started = runtime.start(
    {
      executable: process.execPath,
      args: ['-e', 'console.log("done")'],
      env: {},
    },
    process.cwd(),
    'stop-with-aevra',
  );

  const status = await runtime.wait(started.processId, 5000);
  assert.equal(status.state, 'completed');
  assert.equal(status.exitCode, 0);
  assert.equal(status.signal, null);
  assert.ok(status.finishedAt);
  assert.ok((status.durationMs ?? -1) >= 0);

  const logs = runtime.logs(started.processId);
  assert.equal(logs.state, 'completed');
  assert.equal(logs.exitCode, 0);
  assert.equal(logs.eof, true);
  assert.ok(logs.lines.includes('done'));
});

test('managed process reports non-zero exit as failed', async () => {
  const runtime = new ManagedProcessRuntime();
  const started = runtime.start(
    {
      executable: process.execPath,
      args: ['-e', 'process.exit(7)'],
      env: {},
    },
    process.cwd(),
    'stop-with-aevra',
  );

  const status = await runtime.wait(started.processId, 5000);
  assert.equal(status.state, 'failed');
  assert.equal(status.exitCode, 7);
  assert.ok(status.finishedAt);
});

test('re-adoption requires pid start identity and exact marker', () => {
  const r = { helperPid: 2, helperStartedAt: 't', marker: 'secret-marker' };
  assert.equal(
    verifyReAdoption(r, { pid: 2, startedAt: 't', commandLine: 'node helper secret-marker' }),
    true,
  );
  assert.equal(
    verifyReAdoption(r, { pid: 2, startedAt: 'wrong', commandLine: 'node helper secret-marker' }),
    false,
  );
});
