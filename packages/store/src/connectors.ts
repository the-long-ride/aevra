import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
export interface ConnectorRecord {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  workspaceId: string | null;
  workspaceIds?: string[];
  workspaceGrants?: Array<{ workspaceId: string; profileId: string }>;
  profileCap: string | null;
  expiresAt: string | null;
}
export interface ConnectorTokenRecord {
  id: string;
  name: string;
  workspaceId: string | null;
  profileCap: string | null;
  expiresAt: string | null;
}
export interface ConnectorCreateInput {
  name: string;
  workspaceId?: string | null;
  workspaceIds?: string[];
  workspaceGrants?: Array<{ workspaceId: string; profileId: string }>;
  profileCap?: string | null;
  expiresAt?: string | null;
}
export class ConnectorRepository {
  constructor(private db: DatabaseSync) {}
  create(input: string | ConnectorCreateInput): { connector: ConnectorRecord; token: string } {
    const x = typeof input === 'string' ? { name: input } : input;
    const token = randomBytes(16).toString('base64url');
    const hash = ConnectorRepository.hash(token);
    const nowIso = new Date().toISOString();
    const wsIds = Array.isArray(x.workspaceIds)
      ? x.workspaceIds.map(String).filter(Boolean)
      : x.workspaceId
        ? [String(x.workspaceId)]
        : [];
    const primaryWsId = wsIds[0] ?? x.workspaceId ?? null;
    const grants =
      x.workspaceGrants ??
      wsIds.map((wid) => ({ workspaceId: wid, profileId: x.profileCap ?? 'read-only' }));
    const connector: ConnectorRecord = {
      id: `con_${randomUUID()}`,
      name: x.name,
      createdAt: nowIso,
      lastUsedAt: null,
      workspaceId: primaryWsId,
      workspaceIds: wsIds,
      workspaceGrants: grants,
      profileCap: x.profileCap ?? null,
      expiresAt: x.expiresAt ?? null,
    };
    this.db
      .prepare(
        'INSERT INTO connectors(id,name,token_hash,created_at,workspace_id,profile_cap,expires_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        connector.id,
        connector.name,
        hash,
        connector.createdAt,
        connector.workspaceId,
        connector.profileCap,
        connector.expiresAt,
      );
    if (grants.length) {
      try {
        const stmt = this.db.prepare(
          `INSERT INTO oauth_workspace_grants(subject,workspace_id,profile_id,created_at,updated_at)
           VALUES(?,?,?,?,?)
           ON CONFLICT(subject,workspace_id) DO UPDATE SET profile_id=excluded.profile_id,updated_at=excluded.updated_at`,
        );
        for (const grant of grants) {
          stmt.run(connector.id, grant.workspaceId, grant.profileId, nowIso, nowIso);
        }
      } catch {
        /* ignore if oauth_workspace_grants table does not exist */
      }
    }
    return { connector, token };
  }
  list(): ConnectorRecord[] {
    return this.db
      .prepare(
        'SELECT id,name,created_at createdAt,last_used_at lastUsedAt,workspace_id workspaceId,profile_cap profileCap,expires_at expiresAt FROM connectors ORDER BY created_at',
      )
      .all() as unknown as ConnectorRecord[];
  }
  findByToken(token: string, now: number = Date.now()): ConnectorTokenRecord | null {
    const hash = ConnectorRepository.hash(token);
    const row = this.db
      .prepare(
        'SELECT id,name,workspace_id workspaceId,profile_cap profileCap,expires_at expiresAt,token_hash tokenHash,previous_token_hash previousTokenHash,previous_expires_at previousExpiresAt FROM connectors WHERE token_hash=? OR (previous_token_hash IS NOT NULL AND previous_token_hash=?)',
      )
      .get(hash, hash) as any | undefined;
    if (!row) return null;
    const eq = (candidate: string) =>
      candidate !== '' &&
      candidate.length === hash.length &&
      timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
    const isCurrent = eq(String(row.tokenHash ?? '')),
      isPrevious = eq(String(row.previousTokenHash ?? ''));
    if (!isCurrent && !isPrevious) return null;
    if (isPrevious && (!row.previousExpiresAt || Date.parse(row.previousExpiresAt) <= now))
      return null; // grace expired
    if (row.expiresAt && Date.parse(row.expiresAt) <= now) return null; // connector TTL expired
    return {
      id: String(row.id),
      name: String(row.name),
      workspaceId: row.workspaceId ?? null,
      profileCap: row.profileCap ?? null,
      expiresAt: row.expiresAt ?? null,
    };
  }
  isActive(id: string, now = Date.now()): boolean {
    return Boolean(
      this.db
        .prepare('SELECT 1 FROM connectors WHERE id=? AND (expires_at IS NULL OR expires_at>?)')
        .get(id, new Date(now).toISOString()),
    );
  }
  revoke(id: string) {
    this.db.prepare('DELETE FROM connectors WHERE id=?').run(id);
    try {
      this.db.prepare('DELETE FROM oauth_workspace_grants WHERE subject=?').run(id);
    } catch {
      /* ignore if oauth_workspace_grants table does not exist */
    }
  }
  rotate(id: string, graceMs: number = 5 * 60_000): string | null {
    const row = this.db
      .prepare('SELECT token_hash,previous_expires_at previousExpiresAt FROM connectors WHERE id=?')
      .get(id) as any | undefined;
    if (!row) return null;
    const token = randomBytes(16).toString('base64url');
    const now = Date.now();
    this.db
      .prepare(
        'UPDATE connectors SET previous_token_hash=token_hash,previous_expires_at=?,token_hash=? WHERE id=?',
      )
      .run(new Date(now + graceMs).toISOString(), ConnectorRepository.hash(token), id);
    return token;
  }
  getBindings(id: string): { workspaceId: string | null; profileCap: string | null } | null {
    const row = this.db
      .prepare('SELECT workspace_id workspaceId,profile_cap profileCap FROM connectors WHERE id=?')
      .get(id) as any | undefined;
    return row
      ? { workspaceId: row.workspaceId ?? null, profileCap: row.profileCap ?? null }
      : null;
  }
  grantWorkspace(connectorId: string, workspaceId: string, profileId = 'read-only') {
    const now = new Date().toISOString();
    try {
      this.db
        .prepare(
          `INSERT INTO oauth_workspace_grants(subject,workspace_id,profile_id,created_at,updated_at)
           VALUES(?,?,?,?,?)
           ON CONFLICT(subject,workspace_id) DO UPDATE SET profile_id=excluded.profile_id,updated_at=excluded.updated_at`,
        )
        .run(connectorId, workspaceId, profileId, now, now);
    } catch {
      /* ignore if oauth_workspace_grants table does not exist */
    }
    const row = this.db.prepare('SELECT workspace_id workspaceId FROM connectors WHERE id=?').get(connectorId) as any;
    if (row && !row.workspaceId) {
      this.db.prepare('UPDATE connectors SET workspace_id=? WHERE id=?').run(workspaceId, connectorId);
    }
  }
  revokeWorkspace(connectorId: string, workspaceId: string): boolean {
    let removed = false;
    try {
      removed =
        this.db
          .prepare('DELETE FROM oauth_workspace_grants WHERE subject=? AND workspace_id=?')
          .run(connectorId, workspaceId).changes > 0;
    } catch {
      removed = false;
    }
    this.clearWorkspace(connectorId, workspaceId);
    return removed;
  }
  listWorkspaceGrants(connectorId: string): Array<{ workspaceId: string; profileId: string }> {
    try {
      return this.db
        .prepare(
          'SELECT workspace_id workspaceId,profile_id profileId FROM oauth_workspace_grants WHERE subject=? ORDER BY workspace_id',
        )
        .all(connectorId) as Array<{ workspaceId: string; profileId: string }>;
    } catch {
      return [];
    }
  }
  clearWorkspace(id: string, workspaceId: string) {
    this.db
      .prepare('UPDATE connectors SET workspace_id=NULL WHERE id=? AND workspace_id=?')
      .run(id, workspaceId);
  }
  setWorkspace(id: string, workspaceId: string | null) {
    this.db.prepare('UPDATE connectors SET workspace_id=? WHERE id=?').run(workspaceId, id);
  }
  recordUse(id: string) {
    const now = new Date().toISOString(),
      cutoff = new Date(Date.now() - 60_000).toISOString();
    this.db
      .prepare(
        'UPDATE connectors SET last_used_at=? WHERE id=? AND (last_used_at IS NULL OR last_used_at<?)',
      )
      .run(now, id, cutoff);
  }
  private static hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
