import { migrateOAuthActors } from './migrations/oauth-actor-origin.js';
import type { DatabaseSync } from 'node:sqlite';
import { connectorNoteReadOnConnectMigrations } from './migrations/connector-note-read-on-connect.js';
import { connectorNotesMigrations } from './migrations/connector-notes.js';
import { controlPlanDesktopMigrations } from './migrations/control-plan-desktop.js';
import { gatewayFoundationMigrations } from './migrations/gateway-foundation.js';
import { hostControlMigrations } from './migrations/host-control.js';
import { tokenUsageMigrations } from './migrations/token-usage.js';
import { upstreamAuthPolicyMigrations } from './migrations/upstream-auth-policy.js';

export const migrations: Array<{
  version: number;
  name: string;
  sql: string;
  apply?: (db: DatabaseSync) => void;
}> = [
  ...gatewayFoundationMigrations,
  ...upstreamAuthPolicyMigrations,
  ...controlPlanDesktopMigrations,
  ...hostControlMigrations,
  ...tokenUsageMigrations,
  { version: 26, name: '026_oauth_actor_origin', sql: '', apply: migrateOAuthActors },
  ...connectorNotesMigrations,
  ...connectorNoteReadOnConnectMigrations,
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
      if (m.sql) db.exec(m.sql);
      m.apply?.(db);
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
