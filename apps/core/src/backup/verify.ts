import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
export interface BackupInspection {
  file: string;
  integrityOk: boolean;
  integrityMessage: string;
  tables: string[];
  counts: Record<string, number>;
  sizeBytes: number;
}
export function inspectBackup(file: string, open: (f: string) => DatabaseSync): BackupInspection {
  const db = open(file);
  try {
    const integrity = (
      db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>
    )
      .map((r) => r.integrity_check)
      .join(';');
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    const counts: Record<string, number> = {};
    for (const t of tables) {
      try {
        counts[t] = Number((db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get() as any).c);
      } catch {
        counts[t] = -1;
      }
    }
    return {
      file: path.resolve(file),
      integrityOk: integrity === 'ok',
      integrityMessage: integrity,
      tables,
      counts,
      sizeBytes: fs.statSync(file).size,
    };
  } finally {
    db.close();
  }
}
export function restoreBackup(
  file: string,
  stateDir: string,
): { databasePath: string; previousBackedUpTo: string | null } {
  const target = path.join(stateDir, 'aevra.db');
  let previousBackedUpTo: string | null = null;
  if (fs.existsSync(target)) {
    previousBackedUpTo = path.join(stateDir, `aevra.db.pre-restore-${Date.now()}`);
    fs.copyFileSync(target, previousBackedUpTo);
  }
  fs.mkdirSync(stateDir, { recursive: true });
  fs.copyFileSync(path.resolve(file), target);
  return { databasePath: target, previousBackedUpTo };
}
