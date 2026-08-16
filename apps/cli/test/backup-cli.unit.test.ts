import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { inspectBackup, restoreBackup } from '../../core/src/backup/verify.js';
function run(file: string) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout=5000;');
  return db;
}
test('inspectBackup verifies integrity and reports table counts', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aevra-bak-'));
  const live = AevraDatabase.open(path.join(dir, 'live.db'));
  const raw = live.raw();
  raw
    .prepare(
      'INSERT INTO workspaces(id,name,description,host_root,created_at,updated_at) VALUES(?,?,?,?,?,?)',
    )
    .run('w1', 'ws', '', '/tmp/x', new Date().toISOString(), new Date().toISOString());
  const backupPath = path.join(dir, 'backup.db');
  live.backup(backupPath);
  live.close();
  const inspection = inspectBackup(backupPath, run);
  assert.equal(inspection.integrityOk, true);
  assert.equal(inspection.counts['workspaces'], 1);
  assert.equal(inspection.counts['schema_migrations'] > 0, true);
  assert.ok(inspection.sizeBytes > 0);
});
test('restoreBackup seeds a fresh state dir and preserves the previous db', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aevra-restore-'));
  const source = AevraDatabase.open(path.join(dir, 'src.db'));
  const backupPath = path.join(dir, 'bak.db');
  source.backup(backupPath);
  source.close();
  const stateDir = path.join(dir, 'state');
  const r = restoreBackup(backupPath, stateDir);
  assert.ok(r.previousBackedUpTo === null || typeof r.previousBackedUpTo === 'string');
  const reopened = AevraDatabase.open(path.join(stateDir, 'aevra.db'));
  assert.equal(reopened.integrityCheck().ok, true);
  reopened.close();
  // second restore with an existing db keeps a .pre-restore copy
  const r2 = restoreBackup(backupPath, stateDir);
  assert.ok(r2.previousBackedUpTo !== null);
});
