import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DesktopSessionRegistry } from '../../../packages/desktop/src/registry.js';
import { DesktopDriverError } from '../../../packages/desktop/src/driver.js';
import type { DesktopDriver } from '../../../packages/desktop/src/driver.js';
import { HelperProcess } from '../../../packages/desktop/src/helper-process.js';
import { WindowsDesktopDriver } from '../../../packages/desktop/src/windows-driver.js';

const DEFAULT_DEADLINE_MS = 10_000;

/**
 * Resolves the compiled helper binary's path.
 *
 * `AEVRA_DESKTOP_HELPER_PATH`, when set, is authoritative: it is used
 * whether or not a file exists there, and a miss is reported as "not
 * installed" rather than silently falling back to a default location. That
 * makes the not-installed path deterministic for tests regardless of
 * whatever a developer happens to have built locally (see
 * `apps/worker/test/desktop-dispatch.integration.test.ts`).
 *
 * With no override, the release build is preferred and the debug build
 * (what a plain `cargo build` in `helper/` produces) is the fallback, so an
 * ordinary local build-and-test loop finds the binary without configuring
 * anything.
 *
 * `helper/` is NOT part of the TypeScript project: `tsconfig.json` sets
 * `rootDir: "."` (the repo root) and both the production build (`dist/`) and
 * the test runner's compiled output (`.test-dist/`) wrap the ENTIRE source
 * tree one directory deeper than this file's own source location. So the
 * relative walk below climbs one level further than a plain source-tree
 * distance would suggest, to land beside `dist`/`.test-dist` at the true
 * repo root rather than inside them.
 */
export function resolveHelperBinaryPath(): string | undefined {
  const override = process.env.AEVRA_DESKTOP_HELPER_PATH;
  if (override !== undefined) {
    return existsSync(override) ? override : undefined;
  }
  const release = fileURLToPath(
    new URL('../../../../helper/target/release/aevra-desktop-helper.exe', import.meta.url),
  );
  if (existsSync(release)) return release;
  const debug = fileURLToPath(
    new URL('../../../../helper/target/debug/aevra-desktop-helper.exe', import.meta.url),
  );
  if (existsSync(debug)) return debug;
  return undefined;
}

/**
 * Worker-side owner of the single live desktop session, held as a module
 * singleton the way `processRuntime` and `browserRuntime` are.
 *
 * `createDriver` now constructs a real `WindowsDesktopDriver` over a
 * `HelperProcess` supervising the compiled Rust helper (Task 9a). When the
 * binary cannot be found, the failure is reported as
 * `DESKTOP_HELPER_NOT_INSTALLED` -- distinct from `DESKTOP_DRIVER_DIED`,
 * which means the helper started and then died or was killed. Conflating
 * the two was flagged in a Task 7 review: "not there" and "died" call for
 * different remediation, so they get different codes. (No central table of
 * `DESKTOP_*` codes exists yet in `docs/` to add this one to -- that
 * directory is owned by another agent working in this checkout, so this
 * comment is, for now, where the new code is documented.)
 */
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
        'The desktop helper binary is not installed on this worker. Build it with ' +
          '`cargo build --release` inside helper/, or set AEVRA_DESKTOP_HELPER_PATH.',
      );
    }
    const helper = new HelperProcess({
      command: binaryPath,
      args: [],
      deadlineMs: DEFAULT_DEADLINE_MS,
    });
    return new WindowsDesktopDriver(helper);
  }

  async shutdown(): Promise<void> {
    await this.sessions.disconnect();
  }
}

export const desktopRuntime = new DesktopRuntime();
