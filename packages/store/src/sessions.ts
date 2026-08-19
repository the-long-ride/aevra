import type { DatabaseSync } from 'node:sqlite';
export class SessionRepository {
  constructor(private db: DatabaseSync) {}
  create(s: any) {
    this.db
      .prepare(
        'INSERT INTO sessions(id,actor,subject,created_at,last_activity_at,remote_ip,valid) VALUES(?,?,?,?,?,?,1)',
      )
      .run(s.id, s.actor, s.subject, s.createdAt, s.lastActivityAt, s.remoteIp ?? null);
    return s;
  }
  revoke(id: string) {
    this.db.prepare('UPDATE sessions SET valid=0 WHERE id=?').run(id);
    this.revokeSessionLeases(id);
  }
  invalidateAll() {
    this.db.exec('UPDATE sessions SET valid=0; UPDATE workspace_leases SET valid=0;');
  }
  saveLease(l: any) {
    this.db
      .prepare(
        'INSERT INTO workspace_leases(id,session_id,workspace_id,actor,capabilities_json,expires_at,valid) VALUES(?,?,?,?,?,?,1)',
      )
      .run(l.id, l.sessionId, l.workspaceId, l.actor, JSON.stringify(l.capabilities), l.expiresAt);
  }
  revokeSessionLeases(sid: string) {
    this.db.prepare('UPDATE workspace_leases SET valid=0 WHERE session_id=?').run(sid);
  }
}
