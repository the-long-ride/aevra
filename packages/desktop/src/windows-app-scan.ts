import { spawn } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { DesktopAppSource, DesktopCatalogApp } from '../../protocol/src/desktop.js';
import { canonicalExecutablePath } from '../../security/src/window-gate.js';

const APP_SCAN_TIMEOUT_MS = 10_000;
export const APP_SCAN_ROW_LIMIT = 500;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

export interface RawCatalogApp {
  displayName?: unknown;
  version?: unknown;
  executablePath?: unknown;
}

export interface AppSourceScan {
  apps: DesktopCatalogApp[];
  warnings: string[];
}

/** Runs a fixed, read-only PowerShell query without a shell or caller-provided script text. */
export function readPowerShellRows<T>(
  source: string,
  script: string,
  env: NodeJS.ProcessEnv = {},
): Promise<{ rows: T[]; warnings: string[] }> {
  if (process.platform !== 'win32') {
    return Promise.resolve({ rows: [], warnings: [`${source} discovery requires a Windows host`] });
  }

  return new Promise((resolve) => {
    const windowsDirectory = process.env.SystemRoot ?? process.env.WINDIR;
    if (!windowsDirectory) {
      resolve({ rows: [], warnings: [`${source} discovery could not locate Windows PowerShell`] });
      return;
    }
    let child: ReturnType<typeof spawn>;
    try {
      const powershellPath = path.win32.join(
        windowsDirectory,
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      );
      child = spawn(
        powershellPath,
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
        {
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore'],
          env: { ...process.env, ...env },
        },
      );
    } catch {
      resolve({ rows: [], warnings: [`${source} discovery could not start`] });
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    let timedOut = false;
    let oversized = false;
    let settled = false;
    const finish = (result: { rows: T[]; warnings: string[] }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, APP_SCAN_TIMEOUT_MS);
    timer.unref?.();

    child.stdout?.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) {
        oversized = true;
        child.kill();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    child.once('error', () => {
      finish({ rows: [], warnings: [`${source} discovery could not start`] });
    });
    child.once('close', (code) => {
      if (timedOut) {
        finish({ rows: [], warnings: [`${source} discovery timed out after 10 seconds`] });
        return;
      }
      if (oversized) {
        finish({ rows: [], warnings: [`${source} discovery exceeded the output limit`] });
        return;
      }
      if (code !== 0) {
        finish({ rows: [], warnings: [`${source} discovery returned incomplete results`] });
        return;
      }
      try {
        const text = Buffer.concat(chunks)
          .toString('utf8')
          .replace(/^\uFEFF/, '')
          .trim();
        const parsed: unknown = text ? JSON.parse(text) : [];
        const envelope =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as { rows?: unknown; warnings?: unknown })
            : undefined;
        const values = envelope?.rows ?? parsed;
        const rows = Array.isArray(values) ? values : values == null ? [] : [values];
        const warnings = Array.isArray(envelope?.warnings)
          ? envelope.warnings.filter((warning): warning is string => typeof warning === 'string')
          : [];
        if (rows.length > APP_SCAN_ROW_LIMIT)
          warnings.push(`${source} discovery reached the 500 app limit`);
        finish({
          rows: rows.slice(0, APP_SCAN_ROW_LIMIT) as T[],
          warnings: [...new Set(warnings)],
        });
      } catch {
        finish({ rows: [], warnings: [`${source} discovery returned unreadable results`] });
      }
    });
  });
}

export function expandWindowsEnvironmentVariables(value: string): string | undefined {
  let unresolved = false;
  const expanded = value.replace(/%([^%]+)%/g, (token, name: string) => {
    const replacement = process.env[name] ?? process.env[name.toUpperCase()];
    if (!replacement) {
      unresolved = true;
      return token;
    }
    return replacement;
  });
  return unresolved ? undefined : expanded;
}

/** Returns a canonical existing .exe path; a basename or guessed path is never accepted. */
export async function verifiedExecutablePath(value: unknown): Promise<string | undefined> {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const expanded = expandWindowsEnvironmentVariables(value.trim());
  if (
    !expanded ||
    !path.win32.isAbsolute(expanded) ||
    path.win32.extname(expanded).toLowerCase() !== '.exe'
  ) {
    return undefined;
  }
  try {
    const canonical = await realpath(expanded);
    const details = await stat(canonical);
    if (!details.isFile() || path.win32.extname(canonical).toLowerCase() !== '.exe')
      return undefined;
    return path.win32.normalize(canonical);
  } catch {
    return undefined;
  }
}

export function isInstallerOrUpdaterExecutable(executablePath: string): boolean {
  const basename = path.win32.basename(executablePath);
  return /setup|install|update/i.test(basename);
}

export function catalogApp(
  row: RawCatalogApp,
  source: DesktopAppSource,
  executablePath?: string,
  unavailableReason?: DesktopCatalogApp['reason'],
): DesktopCatalogApp | undefined {
  if (typeof row.displayName !== 'string' || !row.displayName.trim()) return undefined;
  const app: DesktopCatalogApp = {
    displayName: row.displayName.trim(),
    version: typeof row.version === 'string' && row.version ? row.version : null,
    sources: [source],
    grantable: Boolean(executablePath) && !unavailableReason,
  };
  if (executablePath) {
    app.executablePath = executablePath;
    app.exeBasename = path.win32.basename(executablePath);
    if (unavailableReason) app.reason = unavailableReason;
  } else {
    app.reason = unavailableReason ?? 'needs-manual-path';
  }
  return app;
}

export async function catalogAppsFromRows(
  rows: RawCatalogApp[],
  source: DesktopAppSource,
): Promise<DesktopCatalogApp[]> {
  const apps = await Promise.all(
    rows.map(async (row) => {
      const verifiedPath = await verifiedExecutablePath(row.executablePath);
      if (
        verifiedPath &&
        path.win32.basename(verifiedPath).toLowerCase() === 'msedgewebview2.exe'
      ) {
        return catalogApp(row, source, verifiedPath, 'shared-runtime');
      }
      const executablePath =
        verifiedPath && !isInstallerOrUpdaterExecutable(verifiedPath) ? verifiedPath : undefined;
      return catalogApp(row, source, executablePath);
    }),
  );
  return apps.filter((app): app is DesktopCatalogApp => app !== undefined);
}

export function canonicalAppPath(value: string): string {
  return canonicalExecutablePath(path.win32.normalize(value.replaceAll('/', '\\')));
}
