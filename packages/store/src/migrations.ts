import type { DatabaseSync } from 'node:sqlite';
import { controlPlanDesktopMigrations } from './migrations/control-plan-desktop.js';
import { gatewayFoundationMigrations } from './migrations/gateway-foundation.js';
import { upstreamAuthPolicyMigrations } from './migrations/upstream-auth-policy.js';

export const migrations = [
  ...gatewayFoundationMigrations,
  ...upstreamAuthPolicyMigrations,
  ...controlPlanDesktopMigrations,
];
export function applyMigrations(db: DatabaseSync) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL)',
  );
  for (const m of migrations) {
    const row = db.prepare('SELECT version FROM schema_migrations WHERE version=?').get(m.version);
    if (row) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)').run(
        m.version,
        m.name,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}
