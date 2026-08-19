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
  ) as { processId: string; pid: number; startedAt: string; marker: string; logPath: string };
  assert.match(value.marker, /^aevra-proc-/);
  assert.equal(path.dirname(value.logPath), root);
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
