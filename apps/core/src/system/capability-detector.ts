import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import type {
  SystemCapabilitySnapshot,
  SystemShellCapability,
  SystemToolCapability,
} from '../../../../packages/protocol/src/index.js';
import { TOOL_PROBES, type Candidate, type ToolProbe } from './capability-tool-probes.js';

const PROBE_TIMEOUT_MS = 1_500;
const PROBE_KILL_GRACE_MS = 250;
const PROBE_OUTPUT_LIMIT = 4_096;
const VERSION_OUTPUT_LIMIT = 160;

export interface CapabilityProbeResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface CapabilityProbeRunner {
  run(
    executable: string,
    args: readonly string[],
    timeoutMs: number,
  ): Promise<CapabilityProbeResult>;
}

const SHELL_PROBES = [
  { id: 'pwsh', label: 'PowerShell 7', args: ['--version'] },
  {
    id: 'powershell',
    label: 'Windows PowerShell',
    args: ['-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'],
  },
  { id: 'cmd', label: 'Command Prompt', args: ['/d', '/c', 'ver'] },
  { id: 'bash', label: 'Bash', args: ['--version'] },
  { id: 'zsh', label: 'Zsh', args: ['--version'] },
  { id: 'sh', label: 'sh', args: ['-c', 'exit 0'] },
  { id: 'wsl', label: 'WSL', args: ['--status'] },
] as const;

class DefaultCapabilityProbeRunner implements CapabilityProbeRunner {
  async run(
    executable: string,
    args: readonly string[],
    timeoutMs: number,
  ): Promise<CapabilityProbeResult> {
    return await new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;
      const child = spawn(executable, [...args], {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const append = (current: string, chunk: unknown) => {
        const remaining = Math.max(0, PROBE_OUTPUT_LIMIT - stdout.length - stderr.length);
        return current + String(chunk ?? '').slice(0, remaining);
      };
      const finish = (result: CapabilityProbeResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        finish({ exitCode: null, stdout, stderr, timedOut: true });
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), PROBE_KILL_GRACE_MS).unref();
      }, timeoutMs);
      child.stdout?.on('data', (chunk) => {
        stdout = append(stdout, chunk);
      });
      child.stderr?.on('data', (chunk) => {
        stderr = append(stderr, chunk);
      });
      child.once('error', () => {
        finish({ exitCode: null, stdout, stderr, timedOut });
      });
      child.once('close', (code) => {
        finish({ exitCode: code, stdout, stderr, timedOut });
      });
    });
  }
}

function normalizedLine(output: string) {
  return output
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .find(Boolean);
}

function normalizeVersion(result: CapabilityProbeResult): string | undefined {
  const line = normalizedLine(result.stdout) ?? normalizedLine(result.stderr);
  if (!line) return undefined;
  const match = line.match(/(?:^|[^\d])v?(\d+(?:\.\d+){1,4}(?:[-+][0-9A-Za-z.-]+)?)/);
  return match?.[1]?.slice(0, VERSION_OUTPUT_LIMIT);
}

function normalizePlatform(
  platform: NodeJS.Platform,
): SystemCapabilitySnapshot['os']['platform'] {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  if (platform === 'linux') return 'linux';
  return 'other';
}

function platformDetail(platform: NodeJS.Platform, release: string) {
  const safeRelease = release
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim()
    .slice(0, 80);
  if (!safeRelease) return undefined;
  if (platform === 'win32') return `Windows kernel ${safeRelease}`;
  if (platform === 'darwin') return `macOS kernel ${safeRelease}`;
  if (platform === 'linux') return `Linux kernel ${safeRelease}`;
  return safeRelease;
}

function unavailableTool(probe: ToolProbe): SystemToolCapability {
  return {
    id: probe.id,
    label: probe.label,
    category: probe.category,
    available: false,
  };
}

async function probeTool(
  probe: ToolProbe,
  runner: CapabilityProbeRunner,
  platform: NodeJS.Platform,
): Promise<SystemToolCapability> {
  const candidates =
    platform === 'win32' && ['npm', 'npx', 'pnpm', 'yarn'].includes(probe.id)
      ? probe.candidates.flatMap(([executable, args]) => [
          [executable, args] as Candidate,
          [
            'cmd.exe',
            ['/d', '/s', '/c', `${executable} ${args.join(' ')}`],
            `${executable}.cmd`,
          ] as Candidate,
        ])
      : probe.candidates;
  for (const [executable, args, reportedExecutable] of candidates) {
    try {
      const result = await runner.run(executable, args, PROBE_TIMEOUT_MS);
      if (result.timedOut || result.exitCode !== 0) continue;
      const version = normalizeVersion(result);
      return {
        id: probe.id,
        label: probe.label,
        category: probe.category,
        available: true,
        executable: reportedExecutable ?? executable,
        ...(version ? { version } : {}),
      };
    } catch {
      // Probe failures are isolated to this candidate.
    }
  }
  return unavailableTool(probe);
}

async function probeShells(runner: CapabilityProbeRunner): Promise<SystemShellCapability[]> {
  const values = await Promise.all(
    SHELL_PROBES.map(async (probe) => {
      try {
        const result = await runner.run(probe.id, probe.args, PROBE_TIMEOUT_MS);
        if (result.timedOut || result.exitCode !== 0) return null;
        const version = normalizeVersion(result);
        return {
          id: probe.id,
          label: probe.label,
          ...(version ? { version } : {}),
        };
      } catch {
        return null;
      }
    }),
  );
  const shells: SystemShellCapability[] = [];
  for (const value of values) {
    if (value) shells.push(value);
  }
  return shells;
}

function recommendedShell(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  shells: SystemShellCapability[],
): string | null {
  const available = new Set(shells.map((shell) => shell.id));
  if (platform === 'win32') {
    return ['pwsh', 'powershell', 'cmd'].find((id) => available.has(id)) ?? null;
  }
  if (platform === 'darwin' || platform === 'linux') {
    const current = path.basename(env.SHELL ?? '');
    if (['zsh', 'bash', 'sh'].includes(current) && available.has(current)) return current;
    const priorities = platform === 'darwin' ? ['zsh', 'bash', 'sh'] : ['bash', 'zsh', 'sh'];
    return priorities.find((id) => available.has(id)) ?? null;
  }
  return null;
}

export function fallbackSystemCapabilitySnapshot(
  options: {
    platform?: NodeJS.Platform;
    arch?: string;
    release?: string;
    now?: () => Date;
  } = {},
): SystemCapabilitySnapshot {
  const platform = options.platform ?? process.platform;
  const release = options.release ?? os.release();
  const detail = platformDetail(platform, release);
  return {
    scope: 'host',
    detectedAt: (options.now ?? (() => new Date()))().toISOString(),
    os: {
      platform: normalizePlatform(platform),
      ...(detail ? { platformDetail: detail } : {}),
      arch: options.arch ?? process.arch,
      recommendedShell: null,
      availableShells: [],
    },
    toolchains: [],
  };
}

export async function detectSystemCapabilities(
  options: {
    platform?: NodeJS.Platform;
    arch?: string;
    env?: NodeJS.ProcessEnv;
    release?: string;
    runner?: CapabilityProbeRunner;
    now?: () => Date;
  } = {},
): Promise<SystemCapabilitySnapshot> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const runner = options.runner ?? new DefaultCapabilityProbeRunner();
  const release = options.release ?? os.release();
  const [toolchains, availableShells] = await Promise.all([
    Promise.all(TOOL_PROBES.map((probe) => probeTool(probe, runner, platform))),
    probeShells(runner),
  ]);
  const detail = platformDetail(platform, release);
  return {
    scope: 'host',
    detectedAt: (options.now ?? (() => new Date()))().toISOString(),
    os: {
      platform: normalizePlatform(platform),
      ...(detail ? { platformDetail: detail } : {}),
      arch: options.arch ?? process.arch,
      recommendedShell: recommendedShell(platform, env, availableShells),
      availableShells,
    },
    toolchains,
  };
}
