import { spawn } from 'node:child_process';
import type { CommandInput, CommandResult } from '../../protocol/src/index.js';
import { redactText } from '../../security/src/dlp.js';
export const COMMAND_OUTPUT_LIMIT = 1024 * 1024;
const TRUNCATED = '\n...[output truncated by Aevra]';
export function appendCommandOutput(current: string, chunk: unknown) {
  const text = String(chunk ?? '');
  if (current.length >= COMMAND_OUTPUT_LIMIT) return { value: current, truncated: true };
  const remaining = COMMAND_OUTPUT_LIMIT - current.length;
  return { value: current + text.slice(0, remaining), truncated: text.length > remaining };
}
export function sanitizeCommandOutput(
  value: string,
  knownSecrets: string[] = [],
  truncated = false,
) {
  const text = redactText(value, knownSecrets).text;
  return truncated ? `${text}${TRUNCATED}` : text;
}
export async function runCommand(input: CommandInput, cwd?: string): Promise<CommandResult> {
  const started = Date.now();
  return await new Promise((resolve, reject) => {
    const child = spawn(input.executable, input.args, {
      cwd,
      env: { ...process.env, ...input.env },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '',
      stdoutTruncated = false,
      stderrTruncated = false,
      timedOut = false;
    const timer = input.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, input.timeoutMs)
      : undefined;
    child.stdout?.on('data', (b) => {
      const next = appendCommandOutput(stdout, b);
      stdout = next.value;
      stdoutTruncated = stdoutTruncated || next.truncated;
    });
    child.stderr?.on('data', (b) => {
      const next = appendCommandOutput(stderr, b);
      stderr = next.value;
      stderrTruncated = stderrTruncated || next.truncated;
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (timer) clearTimeout(timer);
      const secrets = Object.values(input.env);
      resolve({
        exitCode: code,
        signal: signal ?? (timedOut ? 'SIGTERM' : null),
        stdout: sanitizeCommandOutput(stdout, secrets, stdoutTruncated),
        stderr: sanitizeCommandOutput(stderr, secrets, stderrTruncated),
        durationMs: Date.now() - started,
      });
    });
  });
}
