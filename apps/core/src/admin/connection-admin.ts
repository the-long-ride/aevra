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
  ) {}

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
      const workspaceIds = [
        ...new Set(leases.map((lease) => String(lease?.workspaceId ?? '')).filter(Boolean)),
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
        ...(primary ? { remoteIp: primary.remoteIp ?? null } : {}),
        workspaceIds,
        capabilities,
        ...(record.graceExpiresAt ? { graceExpiresAt: record.graceExpiresAt } : {}),
        accessTokenLifetimeSeconds: this.accessTokenLifetimeSeconds,
        ...(family?.expiresAt ? { refreshFamilyExpiresAt: family.expiresAt } : {}),
      };
    });
  }

  revoke(connectionId: string): boolean {
    const existing = this.oauth.getConnection(connectionId);
    if (!existing) return false;
    if (this.sessions.revokeConnection) {
      this.sessions.revokeConnection(connectionId, 'ADMIN_REVOKE');
    } else {
      this.oauth.revokeConnection(connectionId, 'ADMIN_REVOKE');
      this.oauth.clearRememberedWorkspaceGrants(connectionId);
    }
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
