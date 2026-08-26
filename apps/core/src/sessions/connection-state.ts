import type { Clock } from '../../../../packages/protocol/src/index.js';
import type { OAuthRepository } from '../../../../packages/store/src/oauth.js';
import type { VerifiedRemoteIdentity } from '../auth/cloudflare.js';

const systemClock: Clock = { now: () => new Date() };

export type ConnectionStatus = 'CONNECTED' | 'GRACE' | 'OFFLINE' | 'REVOKED';

export interface ConnectionState {
  connectionId: string;
  actor: string;
  subject: string;
  yoloEnabled: boolean;
  status: ConnectionStatus;
  lastUsedAt: string;
  disconnectedAt?: string;
  graceExpiresAt?: string;
}

export class ConnectionStateStore {
  private sessionConnections = new Map<string, string>();

  constructor(
    private repo: OAuthRepository,
    private clock: Clock = systemClock,
  ) {}

  attach(sessionId: string, identity: VerifiedRemoteIdentity) {
    if (!identity.connectionId) return null;
    const record = this.requireActive(identity.connectionId, identity);
    this.sessionConnections.set(sessionId, identity.connectionId);
    this.repo.markConnectionConnected(identity.connectionId);
    return this.project(
      { ...record, disconnectedAt: undefined, graceExpiresAt: undefined },
      'CONNECTED',
    );
  }

  connectionIdForSession(sessionId: string) {
    return this.sessionConnections.get(sessionId) ?? null;
  }

  isYolo(connectionId: string) {
    return Boolean(this.repo.getConnection(connectionId)?.yoloEnabled);
  }

  setYolo(connectionId: string, enabled: boolean) {
    if (!this.repo.setConnectionYolo(connectionId, enabled)) {
      throw new Error('OAuth connection is not active');
    }
  }

  detach(sessionId: string, graceMs: number) {
    const connectionId = this.connectionIdForSession(sessionId);
    if (!connectionId) return null;
    const record = this.repo.getConnection(connectionId);
    if (!record || record.status !== 'ACTIVE') return null;
    const disconnectedAt = this.clock.now();
    const graceExpiresAt = new Date(disconnectedAt.getTime() + graceMs);
    this.repo.markConnectionGrace(
      connectionId,
      disconnectedAt.toISOString(),
      graceExpiresAt.toISOString(),
    );
    return this.state(connectionId);
  }

  resolutionMode(identity: VerifiedRemoteIdentity): 'created' | 'resumed' {
    if (!identity.connectionId) return 'created';
    const record = this.requireActive(identity.connectionId, identity);
    if (!record.graceExpiresAt) return 'created';
    if (Date.parse(record.graceExpiresAt) <= this.clock.now().getTime()) {
      this.repo.clearConnectionGrace(identity.connectionId);
      return 'created';
    }
    return 'resumed';
  }

  state(connectionId: string): ConnectionState | null {
    const record = this.repo.getConnection(connectionId);
    if (!record) return null;
    if (record.status === 'REVOKED') return this.project(record, 'REVOKED');
    if (record.graceExpiresAt && Date.parse(record.graceExpiresAt) > this.clock.now().getTime()) {
      return this.project(record, 'GRACE');
    }
    return this.project(record, record.disconnectedAt ? 'OFFLINE' : 'CONNECTED');
  }

  expireGraceConnections() {
    const now = this.clock.now().getTime();
    const expired: string[] = [];
    for (const record of this.repo.listConnections()) {
      if (
        record.status === 'ACTIVE' &&
        record.graceExpiresAt &&
        Date.parse(record.graceExpiresAt) <= now
      ) {
        this.repo.clearConnectionGrace(record.subject);
        expired.push(record.subject);
      }
    }
    return expired;
  }

  forgetSession(sessionId: string) {
    this.sessionConnections.delete(sessionId);
  }

  revoke(connectionId: string, reason: string, clearWorkspaceGrants = true) {
    this.repo.revokeConnection(connectionId, reason);
    if (clearWorkspaceGrants) this.repo.clearRememberedWorkspaceGrants(connectionId);
    for (const [sessionId, id] of this.sessionConnections) {
      if (id === connectionId) this.sessionConnections.delete(sessionId);
    }
  }

  invalidateForRestart() {
    this.sessionConnections.clear();
  }

  private requireActive(connectionId: string, identity: VerifiedRemoteIdentity) {
    const record = this.repo.getConnection(connectionId);
    if (
      !record ||
      record.status !== 'ACTIVE' ||
      record.subject !== identity.subject ||
      record.actor !== identity.actor ||
      connectionId !== identity.subject
    ) {
      throw new Error('OAuth connection identity mismatch');
    }
    return record;
  }

  private project(record: any, status: ConnectionStatus): ConnectionState {
    return {
      connectionId: record.subject,
      actor: record.actor,
      subject: record.subject,
      yoloEnabled: Boolean(record.yoloEnabled),
      status,
      lastUsedAt: record.lastUsedAt,
      ...(record.disconnectedAt ? { disconnectedAt: record.disconnectedAt } : {}),
      ...(record.graceExpiresAt ? { graceExpiresAt: record.graceExpiresAt } : {}),
    };
  }
}
