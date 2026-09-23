import type { DatabaseSync } from 'node:sqlite';

export type DesktopAccessRequestState = 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED';
export type DesktopAccessDuration = 'session' | 'persistent';

export interface DesktopAccessRequestRecord {
  id: string;
  actor: string;
  sessionId: string;
  workspaceId: string;
  windowId: string;
  targetExecutablePath: string;
  targetProcessId: number;
  targetProcessStartedAt: string;
  hostExecutablePath: string;
  hostWindowId: string;
  hostProcessId: number;
  hostProcessStartedAt: string;
  requestedDuration: DesktopAccessDuration;
  state: DesktopAccessRequestState;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  decisionScope: DesktopAccessDuration | null;
  decidedBy: string | null;
}

export interface DesktopAppGrantRecord {
  id: string;
  executablePath: string;
  pathKey: string;
  scopeKey: string;
  displayName: string;
  createdAt: string;
  createdBy: string;
  sessionId: string | null;
}

export interface NewDesktopAccessRequest extends Omit<DesktopAccessRequestRecord,
  'state' | 'decisionScope' | 'decidedBy'> {}

export interface NewDesktopAppGrant extends Omit<DesktopAppGrantRecord, 'pathKey' | 'scopeKey'> {
  pathKey: string;
}

const requestColumns = `id, actor, session_id AS sessionId, workspace_id AS workspaceId,
  window_id AS windowId, target_executable_path AS targetExecutablePath,
  target_process_id AS targetProcessId, target_process_started_at AS targetProcessStartedAt,
  host_executable_path AS hostExecutablePath, host_window_id AS hostWindowId,
  host_process_id AS hostProcessId, host_process_started_at AS hostProcessStartedAt,
  requested_duration AS requestedDuration, state, expires_at AS expiresAt,
  created_at AS createdAt, updated_at AS updatedAt, decision_scope AS decisionScope,
  decided_by AS decidedBy`;

const grantColumns = `id, executable_path AS executablePath, path_key AS pathKey,
  scope_key AS scopeKey, display_name AS displayName, created_at AS createdAt,
  created_by AS createdBy, session_id AS sessionId`;

export class DesktopAccessRepository {
  constructor(private readonly db: DatabaseSync) {}

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  createOrGetPending(input: NewDesktopAccessRequest): { request: DesktopAccessRequestRecord; existing: boolean } {
    return this.transaction(() => {
      this.db.prepare(`UPDATE desktop_access_requests SET state='EXPIRED',updated_at=?
        WHERE state='PENDING' AND expires_at<=?`).run(input.createdAt, input.createdAt);
      const existing = this.db.prepare(`SELECT ${requestColumns} FROM desktop_access_requests
        WHERE actor=? AND session_id=? AND window_id=? AND target_executable_path=?
          AND target_process_id=? AND target_process_started_at=?
          AND host_executable_path=? AND host_window_id=? AND host_process_id=?
          AND host_process_started_at=? AND state='PENDING'
        ORDER BY created_at DESC LIMIT 1`).get(
        input.actor,
        input.sessionId,
        input.windowId,
        input.targetExecutablePath,
        input.targetProcessId,
        input.targetProcessStartedAt,
        input.hostExecutablePath,
        input.hostWindowId,
        input.hostProcessId,
        input.hostProcessStartedAt,
      ) as DesktopAccessRequestRecord | undefined;
      if (existing) return { request: existing, existing: true };

      this.db.prepare(`INSERT INTO desktop_access_requests(
        id,actor,session_id,workspace_id,window_id,target_executable_path,target_process_id,
        target_process_started_at,host_executable_path,host_window_id,host_process_id,
        host_process_started_at,requested_duration,state,expires_at,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING',?,?,?)`).run(
        input.id,
        input.actor,
        input.sessionId,
        input.workspaceId,
        input.windowId,
        input.targetExecutablePath,
        input.targetProcessId,
        input.targetProcessStartedAt,
        input.hostExecutablePath,
        input.hostWindowId,
        input.hostProcessId,
        input.hostProcessStartedAt,
        input.requestedDuration,
        input.expiresAt,
        input.createdAt,
        input.updatedAt,
      );
      const request = this.getRequest(input.id)!;
      return { request, existing: false };
    });
  }

  getRequest(id: string): DesktopAccessRequestRecord | null {
    const request = this.db.prepare(`SELECT ${requestColumns} FROM desktop_access_requests WHERE id=?`)
      .get(id) as DesktopAccessRequestRecord | undefined;
    return request ?? null;
  }

  expireRequest(id: string, now: string): void {
    this.db.prepare(`UPDATE desktop_access_requests SET state='EXPIRED',updated_at=?
      WHERE id=? AND state='PENDING'`).run(now, id);
  }

  listPending(now: string): DesktopAccessRequestRecord[] {
    this.db.prepare(`UPDATE desktop_access_requests SET state='EXPIRED',updated_at=?
      WHERE state='PENDING' AND expires_at<=?`).run(now, now);
    return this.db.prepare(`SELECT ${requestColumns} FROM desktop_access_requests
      WHERE state='PENDING' ORDER BY created_at`).all() as unknown as DesktopAccessRequestRecord[];
  }

  denyRequest(id: string, decidedBy: string, now: string): DesktopAccessRequestRecord | null {
    return this.transaction(() => {
      const request = this.getRequest(id);
      if (!request || request.state !== 'PENDING') return null;
      if (Date.parse(request.expiresAt) <= Date.parse(now)) {
        this.db.prepare(`UPDATE desktop_access_requests SET state='EXPIRED',updated_at=? WHERE id=? AND state='PENDING'`)
          .run(now, id);
        return null;
      }
      this.db.prepare(`UPDATE desktop_access_requests SET state='DENIED',updated_at=?,decided_by=?
        WHERE id=? AND state='PENDING'`).run(now, decidedBy, id);
      return this.getRequest(id);
    });
  }

  approveRequest(
    id: string,
    scope: DesktopAccessDuration,
    decidedBy: string,
    now: string,
    grant: NewDesktopAppGrant,
  ): { request: DesktopAccessRequestRecord; grant: DesktopAppGrantRecord } | null {
    return this.transaction(() => {
      const request = this.getRequest(id);
      if (!request || request.state !== 'PENDING') return null;
      if (Date.parse(request.expiresAt) <= Date.parse(now)) {
        this.db.prepare(`UPDATE desktop_access_requests SET state='EXPIRED',updated_at=? WHERE id=? AND state='PENDING'`)
          .run(now, id);
        return null;
      }

      const scopeKey = scope === 'persistent' ? 'persistent' : `session:${grant.sessionId}`;
      const existing = this.db.prepare(`SELECT ${grantColumns} FROM desktop_app_grants
        WHERE path_key=? AND scope_key=?`).get(grant.pathKey, scopeKey) as DesktopAppGrantRecord | undefined;
      let storedGrant: DesktopAppGrantRecord;
      if (existing) {
        this.db.prepare('UPDATE desktop_app_grants SET display_name=? WHERE id=?')
          .run(grant.displayName, existing.id);
        storedGrant = { ...existing, displayName: grant.displayName };
      } else {
        this.db.prepare(`INSERT INTO desktop_app_grants(
          id,executable_path,path_key,scope_key,display_name,created_at,created_by,session_id)
          VALUES(?,?,?,?,?,?,?,?)`).run(
          grant.id,
          grant.executablePath,
          grant.pathKey,
          scopeKey,
          grant.displayName,
          grant.createdAt,
          grant.createdBy,
          grant.sessionId,
        );
        storedGrant = this.db.prepare(`SELECT ${grantColumns} FROM desktop_app_grants WHERE id=?`)
          .get(grant.id) as unknown as DesktopAppGrantRecord;
      }
      this.db.prepare(`UPDATE desktop_access_requests SET state='APPROVED',updated_at=?,decision_scope=?,decided_by=?
        WHERE id=? AND state='PENDING'`).run(now, scope, decidedBy, id);
      return { request: this.getRequest(id)!, grant: storedGrant };
    });
  }

  listGrants(): DesktopAppGrantRecord[] {
    return this.db.prepare(`SELECT ${grantColumns} FROM desktop_app_grants ORDER BY display_name COLLATE NOCASE`)
      .all() as unknown as DesktopAppGrantRecord[];
  }

  saveGrant(grant: NewDesktopAppGrant): DesktopAppGrantRecord {
    const scopeKey = grant.sessionId ? `session:${grant.sessionId}` : 'persistent';
    const existing = this.db.prepare(`SELECT ${grantColumns} FROM desktop_app_grants
      WHERE path_key=? AND scope_key=?`).get(grant.pathKey, scopeKey) as DesktopAppGrantRecord | undefined;
    if (existing) {
      this.db.prepare('UPDATE desktop_app_grants SET display_name=? WHERE id=?')
        .run(grant.displayName, existing.id);
      return { ...existing, displayName: grant.displayName };
    }
    this.db.prepare(`INSERT INTO desktop_app_grants(
      id,executable_path,path_key,scope_key,display_name,created_at,created_by,session_id)
      VALUES(?,?,?,?,?,?,?,?)`).run(
      grant.id,
      grant.executablePath,
      grant.pathKey,
      scopeKey,
      grant.displayName,
      grant.createdAt,
      grant.createdBy,
      grant.sessionId,
    );
    return this.db.prepare(`SELECT ${grantColumns} FROM desktop_app_grants WHERE id=?`)
      .get(grant.id) as unknown as DesktopAppGrantRecord;
  }

  renameGrantsForPath(pathKey: string, displayName: string): void {
    this.db.prepare('UPDATE desktop_app_grants SET display_name=? WHERE path_key=?')
      .run(displayName, pathKey);
  }

  revokeGrant(id: string): DesktopAppGrantRecord | null {
    return this.transaction(() => {
      const grant = this.db.prepare(`SELECT ${grantColumns} FROM desktop_app_grants WHERE id=?`)
        .get(id) as DesktopAppGrantRecord | undefined;
      if (!grant) return null;
      this.db.prepare('DELETE FROM desktop_app_grants WHERE id=?').run(id);
      return grant;
    });
  }
}
