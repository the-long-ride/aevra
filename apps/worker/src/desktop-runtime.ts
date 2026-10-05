import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DesktopSessionRegistry } from '../../../packages/desktop/src/registry.js';
import { DesktopDriverError } from '../../../packages/desktop/src/driver.js';
import type { DesktopDriver } from '../../../packages/desktop/src/driver.js';
import { HelperProcess } from '../../../packages/desktop/src/helper-process.js';
import { NativeDesktopDriver } from '../../../packages/desktop/src/native-driver.js';

const DEFAULT_DEADLINE_MS = 10_000;
const OVERRIDE_ENV = 'AEVRA_DESKTOP_HELPER_PATH';

function helperFileName(): string {
  return process.platform === 'win32' ? 'aevra-desktop-helper.exe' : 'aevra-desktop-helper';
}

function defaultCandidates(): string[] {
  const binary = helperFileName();
  const platform = `${process.platform}-${process.arch}`;
  return [
    new URL(`../../../helper/${platform}/${binary}`, import.meta.url),
    new URL(`../../../../helper/target/release/${binary}`, import.meta.url),
    new URL(`../../../../helper/target/debug/${binary}`, import.meta.url),
  ].map((candidate) => fileURLToPath(candidate));
}

export interface HelperResolution {
  path: string | undefined;
  /** Every path probed, in order, including a missing override. */
  checked: string[];
  /** Set when the override env var names a file that does not exist. */
  missingOverride: string | undefined;
}

interface ResolveHelperOptions {
  env?: Record<string, string | undefined>;
  exists?: (path: string) => boolean;
  candidates?: string[];
  warn?: (message: string) => void;
}

/**
 * Finds either a release-packaged helper or a local Cargo build. An existing
 * environment override wins; a blank override is ignored, and a stale one is
 * reported but still falls back to the packaged and Cargo locations.
 */
export function resolveHelperBinaryPath(options: ResolveHelperOptions = {}): HelperResolution {
  const {
    env = process.env,
    exists = existsSync,
    candidates = defaultCandidates(),
    warn = (message: string) => process.emitWarning(message),
  } = options;
  const checked: string[] = [];
  let missingOverride: string | undefined;

  const override = env[OVERRIDE_ENV]?.trim();
  if (override) {
    checked.push(override);
    if (exists(override)) return { path: override, checked, missingOverride };
    missingOverride = override;
    warn(`${OVERRIDE_ENV} points to a missing file (${override}); checking default locations.`);
  }

  for (const candidate of candidates) {
    checked.push(candidate);
    if (exists(candidate)) return { path: candidate, checked, missingOverride };
  }
  return { path: undefined, checked, missingOverride };
}

function notInstalledError(resolution: HelperResolution): DesktopDriverError {
  const stale = resolution.missingOverride
    ? `${OVERRIDE_ENV} points to a missing file (${resolution.missingOverride}); fix or unset it. `
    : '';
  return new DesktopDriverError(
    'DESKTOP_HELPER_NOT_INSTALLED',
    `The desktop helper for ${process.platform}-${process.arch} is not installed. ${stale}` +
      `Checked: ${resolution.checked.join(', ')}. ` +
      `Use an official package/release, build helper/ locally, or set ${OVERRIDE_ENV} to an existing file.`,
    { checkedPaths: resolution.checked, missingOverride: resolution.missingOverride },
  );
}

export class DesktopRuntime {
  private sessions = new DesktopSessionRegistry({ createDriver: () => this.createDriver() });

  constructor(private readonly resolveHelper: () => HelperResolution = resolveHelperBinaryPath) {}

  registry(): DesktopSessionRegistry {
    return this.sessions;
  }

  private async createDriver(): Promise<DesktopDriver> {
    const resolution = this.resolveHelper();
    if (!resolution.path) throw notInstalledError(resolution);
    const helper = new HelperProcess({
      command: resolution.path,
      args: [],
      deadlineMs: DEFAULT_DEADLINE_MS,
    });
    return new NativeDesktopDriver(helper);
  }

  async shutdown(): Promise<void> {
    await this.sessions.disconnect();
  }
}

export const desktopRuntime = new DesktopRuntime();
