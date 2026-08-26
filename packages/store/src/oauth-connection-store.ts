import type { DatabaseSync } from 'node:sqlite';
import { connectionFromRow } from './oauth-records.js';
import type { OAuthConnectionRecord, OAuthGrantRecord } from './oauth-records.js';

const CONNECTION_COLUMNS =
  'subject,client_id clientId,actor,resource,scope,status,yolo_enabled yoloEnabled,created_at createdAt,last_used_at lastUsedAt,revoked_at revokedAt,revoke_reason revokeReason,disconnected_at disconnectedAt,grace_expires_at graceExpiresAt';

export class OAuthConnectionStore {
  constructor(
    private db: DatabaseSync,
    private now: () => Date,
  ) {}

  ensure(grant: OAuthGrantRecord): OAuthConnectionRecord {
    const at = this.now().toISOString();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO oauth_connections(
          subject,client_id,actor,resource,scope,status,yolo_enabled,created_at,last_used_at
        ) VALUES(?,?,?,?,?,'ACTIVE',0,?,?)`,
      )
      .run(grant.subject, grant.clientId, grant.actor, grant.resource, grant.scope, at, at);
    const record = this.get(grant.subject);
    if (!record) throw new Error('OAuth connection could not be persisted');
    if (
      record.clientId !== grant.clientId ||
      record.actor !== grant.actor ||
      record.resource !== grant.resource
    ) {
      throw new Error('OAuth connection binding mismatch');
    }
    return record;
  }

  get(subject: string): OAuthConnectionRecord | null {
    const row = this.db
      .prepare(`SELECT ${CONNECTION_COLUMNS} FROM oauth_connections WHERE subject=?`)
      .get(subject) as any | undefined;
    return row ? connectionFromRow(row) : null;
  }

  list(): OAuthConnectionRecord[] {
    return (
      this.db
        .prepare(`SELECT ${CONNECTION_COLUMNS} FROM oauth_connections ORDER BY last_used_at DESC`)
        .all() as any[]
    ).map(connectionFromRow);
  }

  touch(subject: string) {
    this.db
      .prepare("UPDATE oauth_connections SET last_used_at=? WHERE subject=? AND status='ACTIVE'")
      .run(this.now().toISOString(), subject);
  }

  setYolo(subject: string, enabled: boolean) {
    const result = this.db
      .prepare(
        "UPDATE oauth_connections SET yolo_enabled=?,last_used_at=? WHERE subject=? AND status='ACTIVE'",
      )
      .run(enabled ? 1 : 0, this.now().toISOString(), subject);
    return Number(result.changes) > 0;
  }

  markConnected(subject: string) {
    this.db
      .prepare(
        "UPDATE oauth_connections SET disconnected_at=NULL,grace_expires_at=NULL,last_used_at=? WHERE subject=? AND status='ACTIVE'",
      )
      .run(this.now().toISOString(), subject);
  }

  markGrace(subject: string, disconnectedAt: string, graceExpiresAt: string) {
    this.db
      .prepare(
        "UPDATE oauth_connections SET disconnected_at=?,grace_expires_at=?,last_used_at=? WHERE subject=? AND status='ACTIVE'",
      )
      .run(disconnectedAt, graceExpiresAt, disconnectedAt, subject);
  }

  clearGrace(subject: string) {
    this.db
      .prepare(
        "UPDATE oauth_connections SET grace_expires_at=NULL WHERE subject=? AND status='ACTIVE'",
      )
      .run(subject);
  }

  revoke(subject: string, reason: string) {
    const at = this.now().toISOString();
    this.db
      .prepare(
        `UPDATE oauth_connections
         SET status='REVOKED',yolo_enabled=0,revoked_at=?,revoke_reason=?,disconnected_at=NULL,grace_expires_at=NULL,last_used_at=?
         WHERE subject=?`,
      )
      .run(at, reason, at, subject);
  }
}
