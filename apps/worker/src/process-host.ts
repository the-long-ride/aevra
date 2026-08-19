import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { redactText } from '../../../packages/security/src/dlp.js';

const encoded = process.env.AEVRA_PROCESS_COMMAND;
const logPath = process.env.AEVRA_PROCESS_LOG;
const marker = process.env.AEVRA_PROCESS_MARKER;
if (!encoded || !logPath || !marker) throw new Error('process-host configuration missing');
if (!process.argv.includes(marker))
  throw new Error('process-host ownership marker missing from command line');

const command = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
};
delete process.env.AEVRA_PROCESS_COMMAND;
delete process.env.AEVRA_PROCESS_MARKER;
mkdirSync(path.dirname(logPath), { recursive: true });
const child = spawn(command.executable, command.args, {
  cwd: command.cwd,
  env: { ...process.env, ...command.env },
  shell: false,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const secrets = Object.values(command.env);
for (const stream of [child.stdout, child.stderr]) {
  stream?.on('data', (buffer) => appendFileSync(logPath, redactText(String(buffer), secrets).text));
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (child.exitCode === null) child.kill('SIGTERM');
    process.exit(0);
  });
}
child.once('exit', (code) => process.exit(code ?? 0));
