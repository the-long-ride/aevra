import type { DatabaseSync } from 'node:sqlite';
export class AuditRepository {
  constructor(public readonly db: DatabaseSync) {}
  last() {
    return this.db.prepare('SELECT * FROM audit_events ORDER BY rowid DESC LIMIT 1').get() as any;
  }
  insert(r: any) {
    this.db
      .prepare(
        'INSERT INTO audit_events(id,created_at,event_json,previous_hash,content_hash,class) VALUES(?,?,?,?,?,?)',
      )
      .run(r.id, r.createdAt, r.eventJson, r.previousHash, r.contentHash, r.class ?? 'normal');
  }
  list() {
    return this.db.prepare('SELECT * FROM audit_events ORDER BY rowid').all() as any[];
  }
  checkpoint() {
    return this.db.prepare('SELECT * FROM audit_chain_checkpoints WHERE id=1').get() as any;
  }
  setCheckpoint(previousHash: string, eventId: string | null) {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO audit_chain_checkpoints(id,previous_hash,event_id,created_at) VALUES(1,?,?,?)',
      )
      .run(previousHash, eventId, new Date().toISOString());
  }
  deleteIds(ids: string[]) {
    const st = this.db.prepare('DELETE FROM audit_events WHERE id=?');
    for (const id of ids) st.run(id);
  }
  clearWithCheckpoint() {
    const rows = this.list();
    if (!rows.length) return 0;
    const last = rows[rows.length - 1]!;
    this.setCheckpoint(last.content_hash, last.id);
    this.db.exec('DELETE FROM audit_events');
    return rows.length;
  }
}
