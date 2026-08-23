import { spawn } from 'node:child_process';
import type { WorkerOperation } from '../../protocol/src/worker.js';
import { buildChildEnvironment } from './environment.js';

type HookOperation = Extract<WorkerOperation, { kind: 'hook.run' }>;
const OUTPUT_LIMIT = 128 * 1024;

function append(current: string, chunk: unknown) {
  if (current.length >= OUTPUT_LIMIT) return current;
  return current + String(chunk ?? '').slice(0, OUTPUT_LIMIT - current.length);
}

function environment(op: HookOperation) {
  return buildChildEnvironment({
    ...op.env,
    AEVRA_HOOK_EVENT: op.event,
    AEVRA_HOOK_KIND: op.hookKind,
    AEVRA_HOOK_CONTEXT: JSON.stringify(op.context),
    AEVRA_HOOK_PAYLOAD: JSON.stringify(op.payload),
  });
}

async function launch(op: HookOperation) {
  return await new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn(op.executable, op.args, {
      env: environment(op),
      detached: true,
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('spawn', () => {
      const pid = child.pid;
      child.unref();
      resolve({ launched: true, pid });
    });
  });
}

async function run(op: HookOperation) {
  const started = Date.now();
  return await new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn(op.executable, op.args, {
      env: environment(op),
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, op.timeoutMs);
    child.stdout?.on('data', (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        signal: signal ?? (timedOut ? 'SIGTERM' : null),
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - started,
      });
    });
    child.stdin?.end(JSON.stringify({ event: op.event, kind: op.hookKind, context: op.context, payload: op.payload }));
  });
}

export async function runHookProcess(op: HookOperation) {
  if (!op.executable.trim()) throw new Error('Hook executable is required');
  return op.execution === 'launch' ? launch(op) : run(op);
}
