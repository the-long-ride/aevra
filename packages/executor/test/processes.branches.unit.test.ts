import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ManagedProcessRuntime } from '../src/processes.js';

const node = (script: string, env: Record<string, string> = {}) => ({
  executable: process.execPath,
  args: ['-e', script],
  env,
});

test('a function option is used as the redactor', async () => {
  const runtime = new ManagedProcessRuntime((value) => value.replaceAll('plain', 'masked'));
  const started = runtime.start(
    node('console.log("plain words")'),
    process.cwd(),
    'stop-with-aevra',
  );
  await runtime.wait(started.processId, 5000);
  assert.deepEqual(runtime.logs(started.processId).lines, ['masked words']);
  assert.equal(runtime.logs(started.processId, 1).lines.length, 0);
});

test('the redact option masks output and unknown ids are rejected', async () => {
  const runtime = new ManagedProcessRuntime({ redact: (value) => value.toUpperCase() });
  const started = runtime.start(node('console.log("quiet")'), process.cwd(), 'stop-with-aevra');
  const status = await runtime.wait(started.processId, Number.NaN);
  assert.equal(status.state, 'completed');
  assert.deepEqual(runtime.logs(started.processId).lines, ['QUIET']);
  assert.throws(() => runtime.status('proc_missing'), /managed process not found/);
  assert.throws(() => runtime.stop('proc_missing'), /managed process not found/);
});

test('stop, restart, list and stopWithAevra manage attached processes', async () => {
  const runtime = new ManagedProcessRuntime();
  const longRunning = node('setTimeout(() => {}, 20000)');
  const first = runtime.start(longRunning, process.cwd(), 'stop-with-aevra');
  const immediate = await runtime.wait(first.processId, 0);
  assert.equal(immediate.state, 'running');
  assert.equal(runtime.list().length, 1);

  const restarted = runtime.restart(first.processId);
  assert.notEqual(restarted.processId, first.processId);
  assert.throws(() => runtime.status(first.processId), /not found/);

  const done = runtime.start(node('0'), process.cwd(), 'stop-with-aevra');
  await runtime.wait(done.processId, 5000);
  // Stopping a process that already exited only records the request.
  assert.deepEqual(runtime.stop(done.processId), { processId: done.processId, stopped: true });

  runtime.stopWithAevra();
  const stopped = await runtime.wait(restarted.processId, 5000);
  assert.equal(stopped.state, 'stopped');
  assert.equal(runtime.list().length, 2);
});

test('keep-running requires a configured process host', () => {
  const runtime = new ManagedProcessRuntime({});
  assert.throws(
    () => runtime.start(node('0'), process.cwd(), 'keep-running'),
    /keep-running process host is not configured/,
  );
  const partial = new ManagedProcessRuntime({ processHostEntry: 'host.js' });
  assert.throws(() => partial.start(node('0'), process.cwd(), 'keep-running'), /not configured/);
});

test('keep-running reads the detached log and result sidecar', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-proc-br-'));
  try {
    const host = path.join(dir, 'host.cjs');
    writeFileSync(
      host,
      [
        "const fs = require('node:fs');",
        "fs.writeFileSync(process.env.AEVRA_PROCESS_LOG, 'first line\\nsecond line\\n');",
        'const done = process.env.AEVRA_PROCESS_MARKER && process.argv.includes("--aevra-marker");',
        'fs.writeFileSync(process.env.AEVRA_PROCESS_RESULT, JSON.stringify({',
        "  state: done ? 'completed' : 'failed', exitCode: 0, signal: null,",
        '  finishedAt: new Date().toISOString() }));',
      ].join('\n'),
    );
    const runtime = new ManagedProcessRuntime({
      processHostEntry: host,
      logDir: path.join(dir, 'logs'),
    });
    const started = runtime.start(node('0'), dir, 'keep-running');
    assert.equal(started.lifecycle, 'keep-running');
    assert.ok(started.marker?.startsWith('aevra-proc-'));
    assert.ok(started.logPath && started.resultPath);
    const status = await runtime.wait(started.processId, 10_000);
    assert.equal(status.state, 'completed');
    const logs = runtime.logs(started.processId, 1);
    assert.deepEqual(logs.lines, ['second line']);
    assert.equal(logs.cursor, 2);
    assert.equal(logs.eof, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('keep-running without a written log or finished result stays running', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-proc-br-'));
  try {
    const host = path.join(dir, 'host.cjs');
    writeFileSync(
      host,
      "require('node:fs').writeFileSync(process.env.AEVRA_PROCESS_RESULT, JSON.stringify({ state: 'completed' }));",
    );
    const runtime = new ManagedProcessRuntime({
      processHostEntry: host,
      logDir: path.join(dir, 'logs'),
    });
    const started = runtime.start(node('0'), dir, 'keep-running');
    const deadline = Date.now() + 10_000;
    while (!existsSync(started.resultPath!) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(runtime.status(started.processId).state, 'running');
    const logs = runtime.logs(started.processId);
    assert.deepEqual(logs, { ...logs, cursor: 0, lines: [], eof: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  'a Windows .cmd shim runs through cmd.exe',
  { skip: process.platform !== 'win32' },
  async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-proc-shim-'));
    try {
      const shim = path.join(dir, 'tool.cmd');
      writeFileSync(shim, '@echo off\r\necho shim says %1\r\n');
      const runtime = new ManagedProcessRuntime();
      const started = runtime.start(
        { executable: shim, args: ['hello'], env: {} },
        dir,
        'stop-with-aevra',
      );
      const status = await runtime.wait(started.processId, 10_000);
      assert.equal(status.state, 'completed');
      assert.ok(runtime.logs(started.processId).lines.some((line) => line.includes('shim says')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
