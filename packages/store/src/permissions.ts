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
    const workspaceId = r.workspaceId ?? r.workspace_id ?? null;
    const sessionId = r.sessionId ?? r.session_id ?? null;
    const createdAt = r.createdAt ?? r.created_at ?? new Date().toISOString();
    const lastUsedAt = r.lastUsedAt ?? r.last_used_at ?? null;
    const expiresAt = r.expiresAt ?? r.expires_at ?? null;
    const predicateJson =
      r.predicateJson ?? r.predicate_json ?? (r.predicate ? JSON.stringify(r.predicate) : null);
    const version = r.version ?? (predicateJson ? 2 : 1);
    const status = r.status ?? 'active';
    this.db
      .prepare(
        `INSERT OR REPLACE INTO permission_rules(id,effect,capability,scope,workspace_id,actor,matcher,created_at,last_used_at,expires_at,session_id,version,predicate_json,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        r.id,
        r.effect,
        r.capability,
        r.scope,
        workspaceId,
        r.actor ?? null,
        r.matcher,
        createdAt,
        lastUsedAt,
        expiresAt,
        sessionId,
        version,
        predicateJson,
        status,
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
