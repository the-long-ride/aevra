import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HelperProcess } from '../src/helper-process.js';
import { WindowsDesktopDriver } from '../src/windows-driver.js';

const executable = `aevra-desktop-helper${process.platform === 'win32' ? '.exe' : ''}`;
const rel = fileURLToPath(
  new URL(`../../../../helper/target/release/${executable}`, import.meta.url),
);
const deb = fileURLToPath(
  new URL(`../../../../helper/target/debug/${executable}`, import.meta.url),
);
export const BINARY = existsSync(rel) ? rel : existsSync(deb) ? deb : undefined;

export const SKIP =
  BINARY === undefined
    ? 'The compiled desktop helper binary was not found. Build it with `cargo build` ' +
      '(or `cargo build --release`) inside helper/, then re-run this test.'
    : false;

export function makeDriver(): { driver: WindowsDesktopDriver; teardown: () => Promise<void> } {
  const helper = new HelperProcess({ command: BINARY as string, args: [], deadlineMs: 10000 });
  const driver = new WindowsDesktopDriver(helper);
  return { driver, teardown: () => driver.disconnect() };
}

export const NO_FOCUSED_WINDOW = /no focused window|window \d+ no longer exists/;
