import type { DatabaseSync } from 'node:sqlite';

export type ResumableOperationState = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface ResumableOperation {
  id: string;
  connectionId: string;
  sessionId?: string;
  workspaceId?: string;
  kind: string;
  state: ResumableOperationState;
  result?: unknown;
  createdAt: string;
  updatedAt: string;
}

function parseJson(value: unknown) {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function resumableState(value: unknown): ResumableOperationState {
  switch (String(value)) {
    case 'SUCCEEDED':
      return 'SUCCEEDED';
    case 'FAILED':
      return 'FAILED';
    case 'CANCELLED':
    case 'INTERRUPTED':
      return 'CANCELLED';
    case 'EXECUTING':
      return 'RUNNING';
    default:
      return 'QUEUED';
  }
}

function project(row: any): ResumableOperation | null {
  if (!row?.connection_id) return null;
  return {
    id: String(row.id),
    connectionId: String(row.connection_id),
    ...(row.session_id ? { sessionId: String(row.session_id) } : {}),
    ...(row.workspace_id ? { workspaceId: String(row.workspace_id) } : {}),
    kind: String(row.kind),
    state: resumableState(row.state),
    ...(row.result_json != null ? { result: parseJson(row.result_json) } : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class OperationRepository {
  private connectionResolver?: (sessionId: string) => string | undefined;

  constructor(private db: DatabaseSync) {}

  setConnectionResolver(resolver: (sessionId: string) => string | undefined) {
    this.connectionResolver = resolver;
  }

  put(o: any) {
    const now = new Date().toISOString();
    const connectionId =
      o.connectionId ?? (o.sessionId ? this.connectionResolver?.(String(o.sessionId)) : undefined);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO operations(
          id,session_id,connection_id,workspace_id,kind,state,intent_json,expected_state_json,result_json,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        o.id,
        o.sessionId ?? null,
        connectionId ?? null,
        o.workspaceId ?? null,
        o.kind,
        o.state,
        JSON.stringify(o.intent ?? {}),
        JSON.stringify(o.expectedState ?? {}),
        o.result === undefined ? null : JSON.stringify(o.result),
        o.createdAt ?? now,
        now,
      );
    return o;
  }

  updateState(id: string, state: string, result?: unknown) {
    this.db
      .prepare('UPDATE operations SET state=?,result_json=?,updated_at=? WHERE id=?')
      .run(
        state,
        result === undefined ? null : JSON.stringify(result),
        new Date().toISOString(),
        id,
      );
  }

  incomplete() {
    return this.db
      .prepare(
        "SELECT id,session_id,connection_id,workspace_id,kind,state,result_json,created_at,updated_at FROM operations WHERE state IN ('PREPARING','AUTHORIZED','EXECUTING')",
      )
      .all() as any[];
  }

  getById(id: string): ResumableOperation | null {
    const row = this.db
      .prepare(
        'SELECT id,session_id,connection_id,workspace_id,kind,state,result_json,created_at,updated_at FROM operations WHERE id=?',
      )
      .get(id) as any | undefined;
    return row ? project(row) : null;
  }

  listByConnection(connectionId: string, limit = 50): ResumableOperation[] {
    const bounded = Math.min(100, Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 50));
    return (
      this.db
        .prepare(
          `SELECT id,session_id,connection_id,workspace_id,kind,state,result_json,created_at,updated_at
           FROM operations WHERE connection_id=? ORDER BY updated_at DESC LIMIT ?`,
        )
        .all(connectionId, bounded) as any[]
    )
      .map(project)
      .filter((row): row is ResumableOperation => Boolean(row));
  }

  attachSession(id: string, sessionId: string) {
    const result = this.db
      .prepare('UPDATE operations SET session_id=?,updated_at=? WHERE id=?')
      .run(sessionId, new Date().toISOString(), id);
    return Number(result.changes) > 0;
  }
}
