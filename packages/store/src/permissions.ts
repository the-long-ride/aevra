import type { DatabaseSync } from 'node:sqlite';

export class PermissionRepository {
  constructor(private db: DatabaseSync) {}
  list() {
    return this.db.prepare('SELECT * FROM permission_rules').all() as any[];
  }
  get(id: string) {
    return (this.db.prepare('SELECT * FROM permission_rules WHERE id=?').get(id) as any) ?? null;
  }
  upsert(r: any) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO permission_rules(id,effect,capability,scope,workspace_id,actor,matcher,created_at,last_used_at,expires_at,session_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        r.id,
        r.effect,
        r.capability,
        r.scope,
        r.workspaceId ?? null,
        r.actor ?? null,
        r.matcher,
        r.createdAt ?? new Date().toISOString(),
        r.lastUsedAt ?? null,
        r.expiresAt ?? null,
        r.sessionId ?? null,
      );
    return r;
  }
  upsertMany(rules: any[]) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const rule of rules) this.upsert(rule);
      this.db.exec('COMMIT');
      return rules;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {}
      throw error;
    }
  }
  delete(id: string) {
    this.db.prepare('DELETE FROM permission_rules WHERE id=?').run(id);
  }
  expireSession(sessionId: string) {
    this.db
      .prepare("DELETE FROM permission_rules WHERE scope='session' AND session_id=?")
      .run(sessionId);
  }
}
