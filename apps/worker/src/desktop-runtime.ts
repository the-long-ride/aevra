import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DesktopSessionRegistry } from '../../../packages/desktop/src/registry.js';
import { DesktopDriverError } from '../../../packages/desktop/src/driver.js';
import type { DesktopDriver } from '../../../packages/desktop/src/driver.js';
import { HelperProcess } from '../../../packages/desktop/src/helper-process.js';
import { NativeDesktopDriver } from '../../../packages/desktop/src/native-driver.js';

const DEFAULT_DEADLINE_MS = 10_000;

function helperFileName(): string {
  return process.platform === 'win32' ? 'aevra-desktop-helper.exe' : 'aevra-desktop-helper';
}

function existing(paths: URL[]): string | undefined {
  for (const candidate of paths) {
    const path = fileURLToPath(candidate);
    if (existsSync(path)) return path;
  }
  return undefined;
}

/**
 * Finds either a release-packaged helper or a local Cargo build. The explicit
 * environment override remains authoritative for development and diagnostics.
 */
function resolveHelperBinaryPath(): string | undefined {
  const override = process.env.AEVRA_DESKTOP_HELPER_PATH;
  if (override !== undefined) return existsSync(override) ? override : undefined;

  const binary = helperFileName();
  const platform = `${process.platform}-${process.arch}`;
  return existing([
    new URL(`../../../helper/${platform}/${binary}`, import.meta.url),
    new URL(`../../../../helper/target/release/${binary}`, import.meta.url),
    new URL(`../../../../helper/target/debug/${binary}`, import.meta.url),
  ]);
}

class DesktopRuntime {
  private sessions = new DesktopSessionRegistry({ createDriver: () => this.createDriver() });

  registry(): DesktopSessionRegistry {
    return this.sessions;
  }

  private async createDriver(): Promise<DesktopDriver> {
    const binaryPath = resolveHelperBinaryPath();
    if (!binaryPath) {
      throw new DesktopDriverError(
        'DESKTOP_HELPER_NOT_INSTALLED',
        `The desktop helper for ${process.platform}-${process.arch} is not installed. ` +
          'Use an official package/release, build helper/ locally, or set AEVRA_DESKTOP_HELPER_PATH.',
      );
    }
    const helper = new HelperProcess({
      command: binaryPath,
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
