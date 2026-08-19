import type { DatabaseSync } from 'node:sqlite';
export class ChangeRepository {
  constructor(public readonly db: DatabaseSync) {}
  put(c: any) {
    const n = new Date().toISOString();
    this.db
      .prepare(
        'INSERT OR REPLACE INTO change_sets(id,workspace_id,owner_session_id,name,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(c.id, c.workspaceId, c.ownerSessionId, c.name ?? null, c.state, c.createdAt ?? n, n);
    return c;
  }
  record(m: any) {
    this.db
      .prepare(
        'INSERT INTO change_operations(change_set_id,operation_id,logical_path,before_hash,after_hash,snapshot_path,metadata_json) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        m.changeSetId,
        m.operationId,
        m.logicalPath ?? null,
        m.beforeHash ?? null,
        m.afterHash ?? null,
        m.snapshotPath ?? null,
        JSON.stringify(m.metadata ?? {}),
      );
  }
}
