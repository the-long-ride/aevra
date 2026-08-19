import type { DatabaseSync } from 'node:sqlite';

export class ProcessRepository {
  constructor(private db: DatabaseSync) {}

  put(process: any) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO managed_processes(id,workspace_id,lifecycle,ownership,helper_pid,helper_started_at,marker,command_json,execution_mode,log_path,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        process.id,
        process.workspaceId,
        process.lifecycle,
        process.ownership,
        process.helperPid ?? null,
        process.helperStartedAt ?? null,
        process.marker ?? null,
        JSON.stringify(process.command),
        process.executionMode,
        process.logPath ?? null,
        process.createdAt ?? now,
        now,
      );
    return process;
  }

  list(workspaceId?: string) {
    return workspaceId
      ? this.db.prepare('SELECT * FROM managed_processes WHERE workspace_id=?').all(workspaceId)
      : this.db.prepare('SELECT * FROM managed_processes').all();
  }

  get(id: string) {
    return this.db.prepare('SELECT * FROM managed_processes WHERE id=?').get(id) as any;
  }

  markKeepRunningUncertain() {
    const result = this.db
      .prepare(
        "UPDATE managed_processes SET ownership='detached-uncertain',updated_at=? WHERE lifecycle='keep-running'",
      )
      .run(new Date().toISOString());
    return result?.changes ?? 0;
  }

  delete(id: string) {
    this.db.prepare('DELETE FROM managed_processes WHERE id=?').run(id);
  }
}
