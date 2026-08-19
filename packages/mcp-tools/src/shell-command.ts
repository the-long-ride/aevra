import type { CommandInput, ExecutionMode, RiskTier } from '../../protocol/src/index.js';
import { AevraToolError } from './errors.js';

export type ShellKind = 'auto' | 'powershell' | 'bash' | 'sh';
export interface ShellRunInput {
  script: string;
  shell?: ShellKind;
  executionMode?: ExecutionMode;
  timeoutMs?: number;
  env?: Record<string, unknown>;
}

const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;

function timeout(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_TIMEOUT_MS)
    throw new AevraToolError(
      'INVALID_REQUEST',
      `timeoutMs must be between 1 and ${MAX_TIMEOUT_MS}`,
    );
  return Math.floor(parsed);
}

function environment(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value))
    throw new AevraToolError('INVALID_REQUEST', 'env must be an object');
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, String(item)]),
  );
}

export function shellRiskFloor(_mode: ExecutionMode): RiskTier {
  return 'HIGH';
}

export function buildShellCommand(input: ShellRunInput, platform = process.platform): CommandInput {
  const script = String(input.script ?? '');
  if (!script.trim()) throw new AevraToolError('INVALID_REQUEST', 'shell script is required');
  const mode: ExecutionMode = input.executionMode === 'host' ? 'host' : 'sandbox';
  const requested: ShellKind = ['powershell', 'bash', 'sh'].includes(String(input.shell))
    ? (input.shell as ShellKind)
    : 'auto';
  const shell =
    requested === 'auto'
      ? mode === 'sandbox'
        ? 'bash'
        : platform === 'win32'
          ? 'powershell'
          : 'bash'
      : requested;
  if (mode === 'sandbox' && shell === 'powershell')
    throw new AevraToolError(
      'INVALID_REQUEST',
      'PowerShell requires host execution because the current strict sandbox image is Linux-based',
    );
  const base = { env: environment(input.env), timeoutMs: timeout(input.timeoutMs) };
  if (shell === 'powershell')
    return {
      executable: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      ...base,
    };
  if (shell === 'sh') return { executable: 'sh', args: ['-lc', script], ...base };
  return { executable: 'bash', args: ['-lc', script], ...base };
}
