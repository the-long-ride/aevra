import { randomUUID } from 'node:crypto';
import type { Capability, Clock } from '../../../../packages/protocol/src/index.js';
import type { VerifiedRemoteIdentity } from '../auth/cloudflare.js';
import type { SessionRepository } from '../../../../packages/store/src/sessions.js';
import { ALL_CAPABILITIES, type CapabilityProfileService } from '../policy/capabilities.js';

export interface SecuritySession {
  id: string;
  actor: string;
  subject: string;
  createdAt: string;
  lastActivityAt: string;
  remoteIp?: string;
  activeLeaseId?: string;
}
export interface WorkspaceLease {
  id: string;
  sessionId: string;
  workspaceId: string;
  actor: string;
  capabilities: Capability[];
  expiresAt: string;
}
const systemClock: Clock = { now: () => new Date() };

function isConnectorSessionActor(actor: string) {
  return actor.startsWith('connector:') || actor.startsWith('oauth:');
}

export class SessionManager {
  private sessions = new Map<string, SecuritySession>();
  private leaseRows = new Map<string, WorkspaceLease>();
  private yoloSessions = new Set<string>();
  private disconnectedIdentities = new Map<string, { actor: string; subject: string }>();

  constructor(
    private repo: SessionRepository,
    private profiles: CapabilityProfileService,
    private idleMs = 30 * 60_000,
    private clock: Clock = systemClock,
  ) {}

  setSwitchDrainHandler(_handler: (...args: any[]) => Promise<void>) {}
  isSwitching(_sessionId: string) {
    return false;
  }
  isYolo(sessionId: string) {
    return this.yoloSessions.has(sessionId);
  }
  enableYolo(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('session not found');
    if (!isConnectorSessionActor(session.actor)) {
      throw new Error('YOLO mode is only available for connector sessions');
    }
    this.yoloSessions.add(sessionId);
    return { sessionId, enabled: true, capabilities: [...ALL_CAPABILITIES] };
  }
  disableYolo(sessionId: string) {
    const existed = this.yoloSessions.delete(sessionId);
    return { sessionId, enabled: false, changed: existed };
  }
  connectionIdentity(sessionId: string) {
    const source = this.sessions.get(sessionId) ?? this.disconnectedIdentities.get(sessionId);
    return source ? { actor: source.actor, subject: source.subject } : null;
  }

  async switchWorkspace(
    sessionId: string,
    workspaceId: string,
    overrideProfileId?: string,
    _timeoutMs?: number,
  ) {
    return this.admitWorkspace(sessionId, workspaceId, overrideProfileId);
  }

  create(identity: VerifiedRemoteIdentity, remoteIp?: string): SecuritySession {
    const now = this.clock.now().toISOString();
    const session: SecuritySession = {
      id: `ses_${randomUUID()}`,
      actor: identity.actor,
      subject: identity.subject,
      createdAt: now,
      lastActivityAt: now,
      ...(remoteIp ? { remoteIp } : {}),
    };
    this.sessions.set(session.id, session);
    this.repo.create(session);
    this.restoreConnectionWorkspaces(session);
    return session;
  }
  get(id: string) {
    return this.sessions.get(id) ?? null;
  }
  list() {
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
    this.disconnect(id);
    this.disconnectedIdentities.delete(id);
    this.repo.revoke?.(id);
  }
  touch(id: string, workspaceId?: string) {
    const session = this.sessions.get(id);
    if (!session) throw new Error('session not found');
    session.lastActivityAt = this.clock.now().toISOString();
    const lease = workspaceId ? this.leaseForWorkspace(id, workspaceId) : this.activeLease(id);
    if (lease) {
      const raw = this.leaseRows.get(lease.id);
      if (raw) raw.expiresAt = new Date(this.clock.now().getTime() + this.idleMs).toISOString();
    }
    return session;
  }
  leases(sessionId: string): WorkspaceLease[] {
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

  grantConnectionWorkspace(sessionId: string, workspaceId: string, profileId: string) {
    const source = this.sessions.get(sessionId) ?? this.disconnectedIdentities.get(sessionId);
    if (!source) throw new Error('session identity not found');
    if (!source.actor.startsWith('oauth:')) return null;
    this.repo.rememberWorkspaceGrant(source.subject, workspaceId, profileId);
    let granted: WorkspaceLease | null = null;
    for (const session of this.sessions.values()) {
      if (session.subject !== source.subject || session.actor !== source.actor) continue;
      const admitted = this.admitWorkspace(session.id, workspaceId, profileId);
      if (admitted.status !== 'admitted')
        throw new Error('connection workspace grant could not be admitted');
      if (session.id === sessionId || !granted) granted = admitted.lease;
    }
    return granted;
  }

  admitWorkspace(
    sessionId: string,
    workspaceId: string,
    overrideProfileId?: string,
  ): { status: 'admitted'; lease: WorkspaceLease } | { status: 'approval-required' } {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('session not found');
    const mapping = this.profiles.mapping(session.actor, workspaceId);
    const remembered = session.actor.startsWith('oauth:')
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

  revokeWorkspace(sessionId: string, workspaceId: string) {
    const lease = this.leaseForWorkspace(sessionId, workspaceId);
    if (!lease) return false;
    this.revokeLease(lease.id);
    return true;
  }
  revokeLease(id: string) {
    const lease = this.leaseRows.get(id);
    if (!lease) return;
    this.leaseRows.delete(id);
    this.repo.revokeLease(id);
  }
  disconnect(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session?.actor.startsWith('oauth:')) {
      this.disconnectedIdentities.set(sessionId, {
        actor: session.actor,
        subject: session.subject,
      });
    }
    for (const lease of this.leases(sessionId)) this.revokeLease(lease.id);
    this.yoloSessions.delete(sessionId);
    this.sessions.delete(sessionId);
  }
  invalidateForRestart() {
    this.sessions.clear();
    this.leaseRows.clear();
    this.yoloSessions.clear();
    this.disconnectedIdentities.clear();
    this.repo.invalidateAll();
  }

  private restoreConnectionWorkspaces(session: SecuritySession) {
    if (!session.actor.startsWith('oauth:')) return;
    for (const grant of this.repo.listRememberedWorkspaceGrants(session.subject)) {
      try {
        this.admitWorkspace(session.id, grant.workspaceId, grant.profileId);
      } catch {
        // Stale remembered grants are ignored; later admission can repair them.
      }
    }
  }
}
