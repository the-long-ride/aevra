import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildChildEnvironment } from '../../../packages/executor/src/environment.js';
import { redactText } from '../../../packages/security/src/dlp.js';
import type { ManagedProcessState } from '../../../packages/protocol/src/index.js';

const encoded = process.env.AEVRA_PROCESS_COMMAND;
const logPath = process.env.AEVRA_PROCESS_LOG;
const resultPath = process.env.AEVRA_PROCESS_RESULT;
const marker = process.env.AEVRA_PROCESS_MARKER;
if (!encoded || !logPath || !resultPath || !marker)
  throw new Error('process-host configuration missing');
if (!process.argv.includes(marker))
  throw new Error('process-host ownership marker missing from command line');

const command = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
};
delete process.env.AEVRA_PROCESS_COMMAND;
delete process.env.AEVRA_PROCESS_LOG;
delete process.env.AEVRA_PROCESS_RESULT;
delete process.env.AEVRA_PROCESS_MARKER;
mkdirSync(path.dirname(logPath), { recursive: true });
const child = spawn(command.executable, command.args, {
  cwd: command.cwd,
  env: buildChildEnvironment(command.env),
  shell: false,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const secrets = Object.values(command.env);
for (const stream of [child.stdout, child.stderr]) {
  stream?.on('data', (buffer) => appendFileSync(logPath, redactText(String(buffer), secrets).text));
}

let stopRequested = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stopRequested = true;
    if (child.exitCode === null) child.kill('SIGTERM');
  });
}

child.once('exit', (code, signal) => {
  const state: ManagedProcessState = stopRequested ? 'stopped' : code === 0 ? 'completed' : 'failed';
  const result = {
    state,
    exitCode: code,
    signal,
    finishedAt: new Date().toISOString(),
  };
  const tempPath = `${resultPath}.${process.pid}.tmp`;
  writeFileSync(tempPath, JSON.stringify(result), { encoding: 'utf8', mode: 0o600 });
  renameSync(tempPath, resultPath);
  process.exit(stopRequested ? 0 : (code ?? 1));
});
