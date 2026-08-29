import { spawn } from 'node:child_process';
import type { CommandInput, CommandResult } from '../../protocol/src/index.js';
import { redactText } from '../../security/src/dlp.js';
import { stripControlCharacters } from '../../security/src/untrusted.js';
import { buildChildEnvironment } from './environment.js';
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
  // Command output is untrusted data that flows straight into an AI context and,
  // through approval previews, onto a human's screen. Terminal control sequences
  // and bidi overrides let it render as something other than what it says.
  const text = stripControlCharacters(redactText(value, knownSecrets).text);
  return truncated ? `${text}${TRUNCATED}` : text;
}
export async function runCommand(input: CommandInput, cwd?: string): Promise<CommandResult> {
  const started = Date.now();
  return await new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let stdout = '',
      stderr = '',
      stdoutTruncated = false,
      stderrTruncated = false;
    // Resolve on 'close', never on 'exit': 'exit' can fire before the stdio
    // pipes have flushed, which silently truncated command output.
    const child = spawn(input.executable, input.args, {
      cwd,
      env: buildChildEnvironment(input.env),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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
    child.once('error', (error) => {
      // Failed spawns never emit 'exit'; clear the pending timeout here.
      if (timer) clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({
        exitCode: code,
        signal: signal ?? (timedOut ? 'SIGTERM' : null),
        stdout: sanitizeCommandOutput(stdout, Object.values(input.env), stdoutTruncated),
        stderr: sanitizeCommandOutput(stderr, Object.values(input.env), stderrTruncated),
        durationMs: Date.now() - started,
      });
    });
  });
}
