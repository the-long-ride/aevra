import { spawn } from 'node:child_process';
import path from 'node:path';
import type { DetectedApp, DesktopCatalogApp } from '../../protocol/src/desktop.js';
import {
  APP_SCAN_ROW_LIMIT,
  catalogApp,
  isInstallerOrUpdaterExecutable,
  type AppSourceScan,
  expandWindowsEnvironmentVariables,
  verifiedExecutablePath,
} from './windows-app-scan.js';

const UNINSTALL_KEYS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];

/**
 * A wedged `reg.exe` - a corrupted hive, a slow roaming HKCU profile - would
 * otherwise leave its promise pending forever, and because the whole scan
 * awaits every key, that hangs both the settings route and the `desktop_apps`
 * tool call with no way back. A key that cannot answer in this long is
 * treated as the same "nothing detected here" outcome as a failure.
 */
const QUERY_TIMEOUT_MS = 10_000;
const MAX_REGISTRY_OUTPUT_BYTES = 16 * 1024 * 1024;

/**
 * Decodes reg.exe's raw stdout bytes ONCE, over the whole output.
 *
 * Decoding per chunk would split any multi-byte sequence that happens to
 * straddle a chunk boundary into two undecodable halves, silently corrupting
 * whichever app name it landed in - and the Uninstall hive is comfortably
 * larger than one chunk. Encoding is then a guess by necessity: reg.exe emits
 * the console's OEM codepage, which Node cannot decode natively for the
 * single-byte cases. UTF-8 is tried first because a UTF-8 console (chcp
 * 65001) is the one case decodable exactly; replacement characters mean the
 * bytes were some single-byte codepage instead, and latin1 - which cannot
 * fail - recovers a plausible name rather than a row of U+FFFD.
 */
function decodeRegistryOutput(chunks: Buffer[]): string {
  const bytes = Buffer.concat(chunks);
  const utf8 = bytes.toString('utf8');
  return utf8.includes('�') ? bytes.toString('latin1') : utf8;
}

/**
 * Runs `reg.exe query <key> /s` and resolves its stdout, or '' on any
 * failure. Catalog scans retain partial output and add a warning if a hive
 * times out, exceeds the output cap, or cannot be read.
 */
function registrySourceName(key: string): string {
  if (key.includes('WOW6432Node')) return '32-bit uninstall registry';
  if (key.startsWith('HKCU\\')) return 'per-user uninstall registry';
  return '64-bit uninstall registry';
}

function queryUninstallKey(key: string): Promise<{ output: string; warning?: string }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    let oversized = false;
    const source = registrySourceName(key);
    const finish = (result: { output: string; warning?: string }) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    try {
      const child = spawn('reg.exe', ['query', key, '/s'], {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, QUERY_TIMEOUT_MS);
      timer.unref?.();
      child.stdout?.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_REGISTRY_OUTPUT_BYTES) {
          oversized = true;
          child.kill();
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      child.once('error', () => finish({ output: '', warning: `${source} could not be read` }));
      child.once('close', (code) => {
        const output = decodeRegistryOutput(chunks);
        if (timedOut) {
          finish({ output, warning: `${source} scan timed out after 10 seconds` });
        } else if (oversized) {
          finish({ output, warning: `${source} exceeded the 16 MB output limit` });
        } else {
          finish(
            code === 0 ? { output } : { output, warning: `${source} returned incomplete results` },
          );
        }
      });
    } catch {
      finish({ output: '', warning: `${source} could not be read` });
    }
  });
}

/**
 * `reg query ... /s` prints one unindented key-path line per subkey,
 * followed by its indented `Name    REG_TYPE    Value` lines, with blocks
 * separated by blank lines. This parses that into one values-object per key
 * path (key order preserved, path itself discarded - nothing downstream
 * needs it).
 */
export function parseUninstallBlocks(output: string): Record<string, string>[] {
  const blocks: Record<string, string>[] = [];
  let current: Record<string, string> | null = null;
  for (const line of output.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    if (!/^\s/.test(line)) {
      current = {};
      blocks.push(current);
      continue;
    }
    if (!current) continue;
    const match = /^\s+(.+?)\s+(REG_[A-Z_]+)\s+(.*)$/.exec(line);
    if (!match) continue;
    current[match[1]!] = match[3]!;
  }
  return blocks;
}

/**
 * `DisplayIcon` is the closest thing an Uninstall entry offers to "the app's
 * own executable" - `InstallLocation` is a directory and `UninstallString`
 * usually points at an uninstaller or `msiexec.exe`, not the app itself.
 * Not every installer sets it, and not every value it sets is even an exe
 * (some point at a `.dll` or a bare icon resource), so this is a
 * best-effort signal: an entry this cannot resolve an executable for is
 * dropped by the caller rather than kept with a guessed or empty path.
 */
export function resolveExecutablePath(values: Record<string, string>): string | null {
  const raw = values.DisplayIcon;
  if (!raw) return null;
  const path = raw
    .replace(/,-?\d+$/, '')
    .trim()
    .replace(/^"|"$/g, '');
  return /\.exe$/i.test(path) ? path : null;
}

function basename(executablePath: string): string {
  const trimmed = executablePath.replace(/[\\/]+$/, '');
  const segments = trimmed.split(/[\\/]/);
  return segments[segments.length - 1] ?? '';
}

/**
 * Whether a resolved executable is an installer, updater, or uninstaller
 * rather than the app itself.
 *
 * `DisplayIcon` is only a best-effort signal, and on a real machine a large
 * share of entries resolve this way - 'Docker Desktop' resolves to
 * `Docker Desktop Installer.exe`, 'Microsoft OneDrive' to `OneDriveSetup.exe`,
 * 'Intel(R) Graphics Software' to `Uninstaller.exe`. Offering those in the
 * picker is worse than omitting them: the window gate matches the RUNNING
 * process (`Docker Desktop.exe`), so allowlisting the installer silently
 * refuses every action against the very app the operator believes they just
 * authorized, with nothing anywhere explaining why. Omitting them makes the
 * gap visible instead, and the settings UI offers a by-hand entry field for
 * exactly the apps this drops.
 */
export function isInstallerExe(exeBasename: string): boolean {
  return isInstallerOrUpdaterExecutable(exeBasename);
}

export function toDetectedApp(values: Record<string, string>): DetectedApp | null {
  const displayName = values.DisplayName;
  if (!displayName) return null;
  // Hides Windows Installer components (patches, redistributables) that set
  // this flag specifically so they do not clutter a human-facing app list -
  // the same signal Programs and Features itself uses.
  if (values.SystemComponent === '0x1' || values.SystemComponent === '1') return null;
  const executablePath = resolveExecutablePath(values);
  if (!executablePath) return null;
  const exeBasename = basename(executablePath);
  if (isInstallerExe(exeBasename)) return null;
  return {
    displayName,
    version: values.DisplayVersion ?? null,
    executablePath,
    exeBasename,
  };
}

/**
 * Scans the Windows Uninstall registry keys (64-bit, WOW6432Node, and
 * per-user) for installed apps with a resolvable executable. Windows-only;
 * on any other platform, or on any read failure, this resolves to `[]`
 * rather than throwing, matching every other read in this module - a device
 * where detection can't run just can't populate a picker or tool list yet,
 * which is not fatal to anything else.
 */
export async function detectInstalledApps(): Promise<DetectedApp[]> {
  if (process.platform !== 'win32') return [];
  const results = await Promise.all(UNINSTALL_KEYS.map(queryUninstallKey));
  const seen = new Map<string, DetectedApp>();
  for (const { output } of results) {
    for (const values of parseUninstallBlocks(output)) {
      const app = toDetectedApp(values);
      if (!app) continue;
      // Two products can ship the same exe basename, and the window gate
      // matches on basename alone, so they are genuinely indistinguishable to
      // the policy and must collapse to one row. Which one survives is decided
      // by name rather than by registry scan order, so the picker shows a
      // stable label instead of one that depends on which hive was read first.
      const dedupeKey = app.exeBasename.toLowerCase();
      const existing = seen.get(dedupeKey);
      if (!existing || app.displayName.localeCompare(existing.displayName) < 0) {
        seen.set(dedupeKey, app);
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function toRegistryCatalogApp(
  values: Record<string, string>,
): Promise<DesktopCatalogApp | undefined> {
  const displayName = values.DisplayName?.trim();
  if (!displayName) return Promise.resolve(undefined);
  if (values.SystemComponent === '0x1' || values.SystemComponent === '1') {
    return Promise.resolve(undefined);
  }

  const rawPath = resolveExecutablePath(values);
  const expandedPath = rawPath ? expandWindowsEnvironmentVariables(rawPath) : undefined;
  const candidate =
    expandedPath && !isInstallerExe(path.win32.basename(expandedPath)) ? expandedPath : undefined;
  return verifiedExecutablePath(candidate).then((executablePath) => {
    const record = { displayName, version: values.DisplayVersion ?? null };
    if (
      executablePath &&
      path.win32.basename(executablePath).toLowerCase() === 'msedgewebview2.exe'
    ) {
      return catalogApp(record, 'registry', executablePath, 'shared-runtime');
    }
    return catalogApp(record, 'registry', executablePath);
  });
}

/** Scans uninstall records while retaining entries whose executable needs operator input. */
export async function detectRegistryCatalogApps(): Promise<AppSourceScan> {
  if (process.platform !== 'win32') {
    return { apps: [], warnings: ['Registry discovery requires a Windows host'] };
  }

  const results = await Promise.all(UNINSTALL_KEYS.map(queryUninstallKey));
  const warnings = results.flatMap((result) => (result.warning ? [result.warning] : []));
  const records = results.flatMap(({ output }) => parseUninstallBlocks(output));
  const filtered = records.filter(
    (values) =>
      values.DisplayName && values.SystemComponent !== '0x1' && values.SystemComponent !== '1',
  );
  if (filtered.length > APP_SCAN_ROW_LIMIT) {
    warnings.push('Registry discovery reached the 500 app limit');
  }

  const rows = await Promise.all(filtered.slice(0, APP_SCAN_ROW_LIMIT).map(toRegistryCatalogApp));
  return {
    apps: rows.filter((app): app is DesktopCatalogApp => app !== undefined),
    warnings: [...new Set(warnings)],
  };
}
