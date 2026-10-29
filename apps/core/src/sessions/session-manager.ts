import { randomUUID } from 'node:crypto';
import type { Clock } from '../../../../packages/protocol/src/index.js';
import type { VerifiedRemoteIdentity } from '../auth/cloudflare.js';
import type { SessionRepository } from '../../../../packages/store/src/sessions.js';
import { ALL_CAPABILITIES, type CapabilityProfileService } from '../policy/capabilities.js';
import type { ConnectionStateStore } from './connection-state.js';
import {
  detachedSessionIds,
  detachSession,
  extendLeases,
  disconnectSessionImmediate,
  expireGraceSessionConnections,
  findMatchingConnectionLeases,
  findMatchingConnectionSessions,
  findMatchingDetachedIdentities,
  grantRememberedWorkspaceAcrossSessions,
  invalidateWorkspaceAccess,
  revokeConnectionSessions,
  rebindDetachedLeases,
  restoreRememberedWorkspaces,
  revokeWorkspaceAccess,
  type SessionContext,
} from './session-lease-continuity.js';
import {
  connectionHasMultipleSessions,
  connectionIdentityFor,
  grantSourceFor,
  type GrantSource,
  type SessionScope,
} from './session-connection-scope.js';
import { disableYoloSession, enableYoloSession, isYoloSession } from './session-yolo.js';
import type {
  ConnectionTicketLike,
  DisconnectedIdentity,
  SecuritySession,
  SessionResolution,
  WorkspaceLease,
} from './session-types.js';
export type { SecuritySession, SessionResolution, WorkspaceLease } from './session-types.js';
const systemClock: Clock = { now: () => new Date() };

export class SessionManager {
  private sessions = new Map<string, SecuritySession>();
  private leaseRows = new Map<string, WorkspaceLease>();
  private yoloSessions = new Set<string>();
  private pendingRememberedRestore = new Set<string>();
  private disconnectedIdentities = new Map<string, DisconnectedIdentity>();
  linkRevoker?: (connectionKey: string) => void;
  constructor(
    private repo: SessionRepository,
    private profiles: CapabilityProfileService,
    private idleMs = 30 * 60_000,
    private clock: Clock = systemClock,
    private connections?: ConnectionStateStore,
    private reconnectGraceMs = 15 * 60_000,
  ) {}
  private endLinks(sessionId: string) {
    this.linkRevoker?.(this.connectionIdentity(sessionId)?.connectionId ?? sessionId);
  }
  setSwitchDrainHandler(_handler: (...args: any[]) => Promise<void>) {}
  isSwitching(_sessionId: string) {
    return false;
  }
  isYolo(sessionId: string) {
    return isYoloSession(this.scope(), sessionId);
  }
  enableYolo(sessionId: string) {
    return enableYoloSession(this.scope(), sessionId);
  }
  disableYolo(sessionId: string) {
    return disableYoloSession(this.scope(), sessionId);
  }
  private scope(): SessionScope {
    return {
      sessions: this.sessions,
      disconnected: this.disconnectedIdentities,
      yolo: this.yoloSessions,
      connections: this.connections,
    };
  }
  connectionIdentity(sessionId: string) {
    return connectionIdentityFor(this.scope(), sessionId);
  }
  connectionState(connectionId: string) {
    return this.connections?.state(connectionId) ?? null;
  }
  switchWorkspace(sessionId: string, workspaceId: string, profileId?: string, _timeoutMs?: number) {
    return this.admitWorkspace(sessionId, workspaceId, profileId);
  }
  matchingSessions(connectionId: string) {
    return findMatchingConnectionSessions(this.sessions.values(), connectionId);
  }
  matchingDetachedIdentities(connectionId: string) {
    return findMatchingDetachedIdentities(this.disconnectedIdentities.entries(), connectionId);
  }
  hasMultipleSessionsForConnection(ticket: ConnectionTicketLike) {
    return connectionHasMultipleSessions(this.scope(), ticket, this.clock.now().getTime());
  }
  matchingLeasesForWorkspace(connectionId: string, workspaceId: string) {
    return findMatchingConnectionLeases({
      sessions: this.sessions.values(),
      disconnectedIdentities: this.disconnectedIdentities.entries(),
      leaseRows: this.leaseRows.values(),
      connectionId,
      workspaceId,
    });
  }
  applyLease(lease: WorkspaceLease) {
    this.leaseRows.set(lease.id, lease);
  }

  create(identity: VerifiedRemoteIdentity, remoteIp?: string): SecuritySession {
    if (identity.connectionId && this.connections) this.connections.resolutionMode(identity);
    const now = this.clock.now().toISOString();
    const session: SecuritySession = {
      id: `ses_${randomUUID()}`,
      actor: identity.actor,
      subject: identity.subject,
      ...(identity.connectionId ? { connectionId: identity.connectionId } : {}),
      createdAt: now,
      lastActivityAt: now,
      ...(remoteIp ? { remoteIp } : {}),
    };
    this.sessions.set(session.id, session);
    this.repo.create(session);
    this.connections?.attach(session.id, identity);
    this.pendingRememberedRestore.add(session.id);
    return session;
  }
  getOrCreateForIdentity(identity: VerifiedRemoteIdentity, remoteIp?: string): SessionResolution {
    this.expireGraceConnections();
    const existing = [...this.sessions.values()].find(
      (session) =>
        session.actor === identity.actor &&
        session.subject === identity.subject &&
        session.connectionId === identity.connectionId,
    );
    if (existing) {
      if (remoteIp) existing.remoteIp = remoteIp;
      this.touch(existing.id);
      this.pendingRememberedRestore.add(existing.id);
      return { session: existing, mode: 'existing' };
    }
    const mode = this.connections?.resolutionMode(identity) ?? 'created';
    const detachedIds =
      mode === 'resumed' ? detachedSessionIds(this.disconnectedIdentities, identity) : [];
    const session = this.create(identity, remoteIp);
    if (mode === 'resumed') {
      rebindDetachedLeases({
        sessionIds: detachedIds,
        session,
        leaseRows: this.leaseRows,
        repo: this.repo,
        clock: this.clock,
        leaseForWorkspace: (id, target) => this.leaseForWorkspace(id, target),
        revokeLease: (leaseId) => this.revokeLease(leaseId),
      });
      for (const oldSessionId of detachedIds) {
        this.disconnectedIdentities.delete(oldSessionId);
        this.connections?.forgetSession(oldSessionId);
      }
    }
    return { session, mode };
  }
  get(id: string) {
    return this.sessions.get(id) ?? null;
  }
  list() {
    this.expireGraceConnections();
    return [...this.sessions.values()].map((session) => {
      const leases = this.leases(session.id);
      const lease = leases.length === 1 ? leases[0]! : null;
      return {
        ...session,
        activeLeaseId: lease?.id,
        yolo: this.isYolo(session.id),
        lease,
        leases,
      };
    });
  }
  revoke(id: string) {
    this.disconnectImmediate(id, false);
    this.repo.revoke?.(id);
  }
  revokeConnection(connectionId: string, reason = 'ADMIN_REVOKE') {
    this.linkRevoker?.(connectionId);
    revokeConnectionSessions({
      connectionId,
      sessions: this.sessions.values(),
      disconnectedIdentities: this.disconnectedIdentities,
      disconnect: (id) => this.disconnectImmediate(id, false),
      revokeSession: (id) => this.repo.revoke?.(id),
    });
    this.connections?.revoke(connectionId, reason);
  }
  touch(id: string, workspaceId?: string) {
    const session = this.sessions.get(id);
    if (!session) throw new Error('session not found');
    const now = this.clock.now();
    session.lastActivityAt = now.toISOString();
    extendLeases(this.leaseRows.values(), id, now, this.idleMs, workspaceId);
    return session;
  }
  leases(sessionId: string): WorkspaceLease[] {
    this.ensureRememberedRestored(sessionId);
    const now = this.clock.now().getTime();
    const rows = [...this.leaseRows.values()].filter((lease) => lease.sessionId === sessionId);
    for (const lease of rows) {
      if (Date.parse(lease.expiresAt) <= now) this.revokeLease(lease.id);
    }
    const valid = [...this.leaseRows.values()].filter((lease) => lease.sessionId === sessionId);
    return valid.map((lease) =>
      this.isYolo(sessionId) ? { ...lease, capabilities: [...ALL_CAPABILITIES] } : lease,
    );
  }
  leaseForWorkspace(sessionId: string, workspaceId: string) {
    return this.leases(sessionId).find((lease) => lease.workspaceId === workspaceId) ?? null;
  }
  activeLease(sessionId: string) {
    const leases = this.leases(sessionId);
    return leases.length === 1 ? leases[0]! : null;
  }
  grantConnectionWorkspace(from: GrantSource, workspaceId: string, profileId: string) {
    const source = grantSourceFor(this.scope(), from);
    if (!source.actor.startsWith('oauth:')) return null;
    return grantRememberedWorkspaceAcrossSessions({
      repo: this.repo,
      sessions: this.sessions.values(),
      source,
      workspaceId,
      profileId,
      admitWorkspace: (id, target, profile) => this.admitWorkspace(id, target, profile),
    });
  }
  admitWorkspace(
    sessionId: string,
    workspaceId: string,
    overrideProfileId?: string,
  ): { status: 'admitted'; lease: WorkspaceLease } | { status: 'approval-required' } {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('session not found');
    const mapping = this.profiles.mapping(session.actor, workspaceId);
    const remembered =
      session.actor.startsWith('oauth:') || session.actor.startsWith('connector:')
        ? this.repo
            .listRememberedWorkspaceGrants(session.subject)
            .find((grant) => grant.workspaceId === workspaceId)
        : undefined;
    let profileId = overrideProfileId ?? remembered?.profileId;
    if (!profileId && mapping?.admission === 'auto') profileId = mapping.profileId;
    if (!profileId) return { status: 'approval-required' };
    const profile = this.profiles.get(profileId);
    if (!profile) throw new Error('profile not found');
    const existing = this.leaseForWorkspace(sessionId, workspaceId);
    if (existing) this.revokeLease(existing.id);
    const lease: WorkspaceLease = {
      id: `lease_${randomUUID()}`,
      sessionId: session.id,
      workspaceId,
      actor: session.actor,
      capabilities: [...profile.capabilities],
      expiresAt: new Date(this.clock.now().getTime() + this.idleMs).toISOString(),
    };
    this.leaseRows.set(lease.id, lease);
    this.repo.saveLease(lease);
    if (
      session.actor.startsWith('oauth:') &&
      !overrideProfileId &&
      !remembered &&
      mapping?.admission === 'auto'
    ) {
      this.repo.rememberWorkspaceGrant(session.subject, workspaceId, profileId);
    }
    return { status: 'admitted', lease: this.leaseForWorkspace(session.id, workspaceId) ?? lease };
  }
  /** Runs the restore owed by create()/reconnect, at most once per session. */
  private ensureRememberedRestored(sessionId: string) {
    if (!this.pendingRememberedRestore.delete(sessionId)) return;
    const session = this.sessions.get(sessionId);
    if (!session) return;
    restoreRememberedWorkspaces(this.repo, session, (workspaceId, profileId) => {
      if (this.leaseForWorkspace(session.id, workspaceId)) return null;
      return this.admitWorkspace(session.id, workspaceId, profileId);
    });
  }
  revokeWorkspace(sessionId: string, workspaceId: string) {
    return revokeWorkspaceAccess({
      repo: this.repo,
      sessions: this.sessions,
      sessionId,
      workspaceId,
      leaseForWorkspace: (id, target) => this.leaseForWorkspace(id, target),
      revokeLease: (id) => this.revokeLease(id),
    });
  }
  invalidateWorkspaceAccess(workspaceId: string) {
    invalidateWorkspaceAccess({
      repo: this.repo,
      leaseRows: this.leaseRows.values(),
      workspaceId,
      revokeLease: (id) => this.revokeLease(id),
    });
  }
  revokeLease(id: string) {
    if (!this.leaseRows.delete(id)) return;
    this.repo.revokeLease(id);
  }
  private context(): SessionContext {
    return {
      sessions: this.sessions,
      disconnectedIdentities: this.disconnectedIdentities,
      leaseRows: this.leaseRows,
      yoloSessions: this.yoloSessions,
      pendingRememberedRestore: this.pendingRememberedRestore,
      connections: this.connections,
      repo: this.repo,
      reconnectGraceMs: this.reconnectGraceMs,
      clock: this.clock,
    };
  }
  detach(sessionId: string) {
    detachSession(this.context(), sessionId, (id) => this.revokeLease(id));
  }
  disconnect(sessionId: string) {
    this.endLinks(sessionId);
    this.detach(sessionId);
  }
  expireGraceConnections() {
    expireGraceSessionConnections(this.context(), (id, rem) => this.disconnectImmediate(id, rem));
  }
  invalidateForRestart() {
    this.sessions.clear();
    this.leaseRows.clear();
    this.yoloSessions.clear();
    this.pendingRememberedRestore.clear();
    this.disconnectedIdentities.clear();
    this.connections?.invalidateForRestart();
    this.repo.invalidateAll();
  }
  private disconnectImmediate(sessionId: string, rememberIdentity: boolean) {
    this.endLinks(sessionId);
    disconnectSessionImmediate(this.context(), sessionId, rememberIdentity, (id) =>
      this.revokeLease(id),
    );
  }
}
