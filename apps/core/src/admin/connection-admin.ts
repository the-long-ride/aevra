import type { OAuthRepository } from '../../../../packages/store/src/oauth.js';

export type AdminConnectionStatus = 'CONNECTED' | 'GRACE' | 'OFFLINE' | 'REVOKED';

export interface AdminConnectionProjection {
  id: string;
  connectionId: string;
  sessionId?: string;
  actor: string;
  client: string;
  provider: 'OAuth';
  authType: 'OAuth';
  status: AdminConnectionStatus;
  sessionCount: number;
  yolo: boolean;
  lastUsedAt: string;
  lastActivityAt: string;
  connectedAt?: string;
  remoteIp?: string | null;
  workspaceIds: string[];
  capabilities: string[];
  graceExpiresAt?: string;
  accessTokenLifetimeSeconds: number;
  refreshFamilyExpiresAt?: string;
  renewable?: boolean;
  recentOrigins?: { remoteIp: string; lastSeenAt: string }[];
  workspaceGrants?: { workspaceId: string; profileId: string }[];
}

export interface ConnectionGrantHandler {
  grant(input: { connectionId: string; workspaceId: string; profileId: string }): unknown;
  remove(connectionId: string, workspaceId: string): { removed: boolean } | boolean;
  list(connectionId: string): Array<{ workspaceId: string; profileId: string }>;
}

export class ConnectionAdminService {
  constructor(
    private oauth: OAuthRepository,
    private sessions: {
      list(): any[];
      revokeConnection?(connectionId: string, reason?: string): void;
    },
    private accessTokenLifetimeSeconds: number,
    private now: () => Date = () => new Date(),
    private grantHandler?: ConnectionGrantHandler,
    private onRevoke?: (connectionId: string) => void,
  ) {}

  setGrantHandler(handler: ConnectionGrantHandler) {
    this.grantHandler = handler;
  }

  grantWorkspace(connectionId: string, workspaceId: string, profileId = 'read-only') {
    if (!this.grantHandler) throw new Error('Workspace grant handler not configured');
    return this.grantHandler.grant({ connectionId, workspaceId, profileId });
  }

  revokeWorkspace(connectionId: string, workspaceId: string): boolean {
    if (!this.grantHandler) return false;
    const res = this.grantHandler.remove(connectionId, workspaceId);
    return typeof res === 'boolean' ? res : Boolean(res?.removed);
  }

  list(): AdminConnectionProjection[] {
    const sessions = this.sessions.list?.() ?? [];
    return this.oauth.listConnections().map((record) => {
      const matching = sessions.filter(
        (session) =>
          session.connectionId === record.subject ||
          (session.actor === record.actor && session.subject === record.subject),
      );
      const primary = matching[0];
      const leases = matching.flatMap((session) =>
        Array.isArray(session.leases) ? session.leases : session.lease ? [session.lease] : [],
      );
      const origins = this.oauth.listConnectionOrigins?.(record.subject) ?? [];
      const grants = this.grantHandler?.list(record.subject) ?? [];
      const rememberedWorkspaceIds = grants.map((g) => g.workspaceId);
      const workspaceIds = [
        ...new Set(
          [
            ...leases.map((lease) => String(lease?.workspaceId ?? '')),
            ...rememberedWorkspaceIds,
          ].filter(Boolean),
        ),
      ];
      const capabilities = [
        ...new Set(leases.flatMap((lease) => lease?.capabilities ?? []).map(String)),
      ];
      const family = this.oauth.getLatestRefreshFamily(record.subject);
      const lastActivityAt = this.latestActivity(matching) ?? record.lastUsedAt;
      return {
        id: record.subject,
        connectionId: record.subject,
        ...(primary?.id ? { sessionId: String(primary.id) } : {}),
        actor: record.actor,
        client: record.actor.replace(/^oauth:/, ''),
        provider: 'OAuth',
        authType: 'OAuth',
        status: this.status(record, matching.length),
        sessionCount: matching.length,
        yolo: Boolean(record.yoloEnabled),
        lastUsedAt: record.lastUsedAt,
        lastActivityAt,
        ...(primary?.createdAt ? { connectedAt: String(primary.createdAt) } : {}),
        remoteIp: origins[0]?.remoteIp ?? primary?.remoteIp ?? null,
        workspaceIds,
        capabilities,
        ...(record.graceExpiresAt ? { graceExpiresAt: record.graceExpiresAt } : {}),
        accessTokenLifetimeSeconds: this.accessTokenLifetimeSeconds,
        ...(family?.expiresAt ? { refreshFamilyExpiresAt: family.expiresAt } : {}),
        renewable: Boolean(
          family &&
          family.status === 'ACTIVE' &&
          Date.parse(family.expiresAt) > this.now().getTime(),
        ),
        recentOrigins: origins,
        workspaceGrants: grants,
      };
    });
  }

  revoke(connectionId: string): boolean {
    const existing = this.oauth.getConnection(connectionId);
    if (!existing) return false;
    this.sessions.revokeConnection?.(connectionId, 'ADMIN_REVOKE');
    this.oauth.revokeConnection(connectionId, 'ADMIN_REVOKE');
    this.oauth.clearRememberedWorkspaceGrants(connectionId);
    this.onRevoke?.(connectionId);
    return true;
  }

  private status(record: any, sessionCount: number): AdminConnectionStatus {
    if (record.status === 'REVOKED') return 'REVOKED';
    if (sessionCount > 0) return 'CONNECTED';
    if (record.graceExpiresAt && Date.parse(record.graceExpiresAt) > this.now().getTime()) {
      return 'GRACE';
    }
    return 'OFFLINE';
  }

  private latestActivity(sessions: any[]) {
    let latest: string | undefined;
    for (const session of sessions) {
      const value = String(session.lastActivityAt ?? session.createdAt ?? '');
      if (value && (!latest || Date.parse(value) > Date.parse(latest))) latest = value;
    }
    return latest;
  }
}
