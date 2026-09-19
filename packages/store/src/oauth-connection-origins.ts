import type { DatabaseSync } from 'node:sqlite';

export interface ConnectionOriginRecord {
  remoteIp: string;
  lastSeenAt: string;
}

export class OAuthConnectionOriginsRepository {
  constructor(private db: DatabaseSync) {}

  record(subject: string, remoteIp: string, at: string): void {
    if (!subject || !remoteIp) return;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare(
          `INSERT INTO oauth_connection_origins(subject, remote_ip, last_seen_at)
           VALUES(?,?,?)
           ON CONFLICT(subject, remote_ip) DO UPDATE SET last_seen_at=excluded.last_seen_at`,
        )
        .run(subject, remoteIp, at);

      const cutoff = new Date(Date.parse(at) - 24 * 60 * 60 * 1000).toISOString();
      this.db
        .prepare('DELETE FROM oauth_connection_origins WHERE subject=? AND last_seen_at < ?')
        .run(subject, cutoff);

      this.db
        .prepare(
          `DELETE FROM oauth_connection_origins
           WHERE subject=? AND remote_ip NOT IN (
             SELECT remote_ip FROM oauth_connection_origins
             WHERE subject=?
             ORDER BY last_seen_at DESC, remote_ip ASC
             LIMIT 10
           )`,
        )
        .run(subject, subject);

      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  list(subject: string, now: string): ConnectionOriginRecord[] {
    if (!subject) return [];
    const cutoff = new Date(Date.parse(now) - 24 * 60 * 60 * 1000).toISOString();
    this.db
      .prepare('DELETE FROM oauth_connection_origins WHERE subject=? AND last_seen_at < ?')
      .run(subject, cutoff);

    const rows = this.db
      .prepare(
        `SELECT remote_ip AS remoteIp, last_seen_at AS lastSeenAt
         FROM oauth_connection_origins
         WHERE subject=?
         ORDER BY last_seen_at DESC, remote_ip ASC
         LIMIT 10`,
      )
      .all(subject) as any[];

    return rows.map((r) => ({ remoteIp: String(r.remoteIp), lastSeenAt: String(r.lastSeenAt) }));
  }
}
