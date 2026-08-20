import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ManagedProcessRuntime } from '../../../packages/executor/src/processes.js';

async function until(predicate: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('condition not met within ' + ms + 'ms');
}

test('managed process has bounded logs and explicit stop', async () => {
  const runtime = new ManagedProcessRuntime();
  const processInfo = runtime.start(
    {
      executable: process.execPath,
      args: ['-e', 'console.log("hello") ; setTimeout(()=>{},1000)'],
      env: {},
    },
    process.cwd(),
    'stop-with-aevra',
  );
  await until(() => runtime.logs(processInfo.processId).lines.includes('hello'));
  assert.ok(runtime.logs(processInfo.processId).lines.includes('hello'));
  runtime.stop(processInfo.processId);
});

test('keep-running uses a detached process-host with an ownership marker and redacted persisted log', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aevra-proc-'));
  const processHostEntry = fileURLToPath(new URL('../src/process-host.js', import.meta.url));
  const runtime = new ManagedProcessRuntime({ processHostEntry, logDir: root });
  const value = runtime.start(
    {
      executable: process.execPath,
      args: ['-e', 'console.log(process.env.TEST_SECRET); setTimeout(()=>{},1000)'],
      env: { TEST_SECRET: 'super-secret-value' },
    },
    process.cwd(),
    'keep-running',
  ) as {
    processId: string;
    pid: number;
    startedAt: string;
    marker: string;
    logPath: string;
    resultPath: string;
  };
  assert.match(value.marker, /^aevra-proc-/);
  assert.equal(path.dirname(value.logPath), root);
  assert.equal(path.dirname(value.resultPath), root);
  await until(() => {
    try {
      const t = readFileSync(value.logPath, 'utf8');
      return /REDACTED/.test(t) && !/super-secret-value/.test(t);
    } catch {
      return false;
    }
  });
  const text = readFileSync(value.logPath, 'utf8');
  assert.doesNotMatch(text, /super-secret-value/);
  assert.match(text, /REDACTED/);
  runtime.stop(value.processId);
});

test('keep-running child excludes unrelated parent secrets', async () => {
  const previous = process.env.AEVRA_TEST_PARENT_SECRET;
  process.env.AEVRA_TEST_PARENT_SECRET = 'synthetic-parent-secret';
  const root = mkdtempSync(path.join(tmpdir(), 'aevra-proc-env-'));
  const processHostEntry = fileURLToPath(new URL('../src/process-host.js', import.meta.url));
  const runtime = new ManagedProcessRuntime({ processHostEntry, logDir: root });
  try {
    const value = runtime.start(
      {
        executable: process.execPath,
        args: [
          '-e',
          "console.log(process.env.AEVRA_TEST_PARENT_SECRET === undefined ? 'missing' : 'leaked')",
        ],
        env: {},
      },
      process.cwd(),
      'keep-running',
    ) as { processId: string; logPath: string };
    await until(() => {
      try {
        return /missing|leaked/.test(readFileSync(value.logPath, 'utf8'));
      } catch {
        return false;
      }
    });
    assert.match(readFileSync(value.logPath, 'utf8'), /missing/);
    assert.doesNotMatch(readFileSync(value.logPath, 'utf8'), /leaked/);
  } finally {
    if (previous === undefined) delete process.env.AEVRA_TEST_PARENT_SECRET;
    else process.env.AEVRA_TEST_PARENT_SECRET = previous;
  }
});

test('keep-running persists terminal state after helper exits', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aevra-proc-result-'));
  const processHostEntry = fileURLToPath(new URL('../src/process-host.js', import.meta.url));
  const runtime = new ManagedProcessRuntime({ processHostEntry, logDir: root });
  const value = runtime.start(
    {
      executable: process.execPath,
      args: ['-e', 'process.exit(7)'],
      env: {},
    },
    process.cwd(),
    'keep-running',
  ) as { processId: string; resultPath: string };

  const status = await runtime.wait(value.processId, 5000);
  assert.equal(status.state, 'failed');
  assert.equal(status.exitCode, 7);
  assert.ok(status.finishedAt);

  const persisted = JSON.parse(readFileSync(value.resultPath, 'utf8'));
  assert.equal(persisted.state, 'failed');
  assert.equal(persisted.exitCode, 7);
});
