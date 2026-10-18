import {
  closeSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// A holder that wrote no readable pid (a crash between open and write) is stale after this long.
const UNREADABLE_STALE_MS = 10 * 60_000;

export const integrationLockPath = (home: string) =>
  path.join(home, '.agents/aevra/integration.lock');

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const readHolder = (file: string): string | null => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

function stale(file: string, holder: string | null): boolean {
  try {
    const pid = Number((JSON.parse(holder ?? '') as { pid?: unknown }).pid);
    if (Number.isSafeInteger(pid) && pid > 0) return !alive(pid);
  } catch {
    // Unreadable holder: judged by age below.
  }
  try {
    return Date.now() - statSync(file).mtimeMs > UNREADABLE_STALE_MS;
  } catch {
    return false;
  }
}

const busy = (file: string) =>
  new Error(
    `AGENT_INSTALL_BUSY: another integration operation holds the lock ${file}; ` +
      'if no Aevra or aevra-browser command is running, delete that file and retry',
  );

// One user-level lock serialises every change to ~/.agents/aevra across both products. A lock
// left by a crashed process (its pid no longer running) is taken over once.
export function acquireIntegrationLock(file: string): () => void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  for (let attempt = 0; ; attempt++) {
    let fd: number;
    try {
      fd = openSync(file, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const holder = readHolder(file);
      if (attempt > 0 || !stale(file, holder)) throw busy(file);
      takeOver(file, holder);
      continue;
    }
    const mine = JSON.stringify({ pid: process.pid, created: new Date().toISOString() });
    writeSync(fd, mine);
    return () => {
      closeSync(fd);
      // Only our own lock: after a takeover race the file may already be someone else's.
      if (readHolder(file) === mine)
        try {
          unlinkSync(file);
        } catch {
          // Already gone: nothing to release.
        }
    };
  }
}

// Moves the dead holder's lock aside instead of deleting it by name: if another process took it
// over in between, what was moved is checked and a live lock is put back.
function takeOver(file: string, holder: string | null): void {
  const aside = `${file}.${randomUUID()}.stale`;
  try {
    renameSync(file, aside);
  } catch {
    return; // Another process moved it first; the next open decides.
  }
  if (readHolder(aside) !== holder)
    try {
      linkSync(aside, file); // Fails if a newer lock already exists, which then stands.
    } catch {
      // A newer holder exists; ours is retried as busy.
    }
  try {
    unlinkSync(aside);
  } catch {
    // Left beside the lock: harmless.
  }
}

export function withIntegrationLock<T>(home: string, run: () => T): T {
  const release = acquireIntegrationLock(integrationLockPath(home));
  try {
    return run();
  } finally {
    release();
  }
}
