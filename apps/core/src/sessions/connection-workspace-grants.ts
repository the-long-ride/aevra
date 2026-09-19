import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { SessionRepository } from '../../../../packages/store/src/sessions.js';
import type { CapabilityProfileService } from '../policy/capabilities.js';
import type { SecuritySession, WorkspaceLease } from './session-types.js';

export interface ConnectionGrant {
  connectionId: string;
  workspaceId: string;
  profileId: string;
}

export interface ConnectionGrantResult {
  grant: ConnectionGrant;
  appliedSessionIds: string[];
}

export interface ConnectionWorkspaceGrantDependencies {
  db: DatabaseSync;
  oauthRepo: {
    getConnection(subject: string): { status: string; actor: string } | null;
  };
  workspaceRepo: {
    get(id: string): unknown | null;
  };
  sessionRepo: SessionRepository;
  profiles: CapabilityProfileService;
  idleMs?: number;
  now?: () => Date;
  sessions: {
    matchingSessions(connectionId: string): SecuritySession[];
    matchingDetachedIdentities?(connectionId: string): Array<{
      sessionId: string;
      actor: string;
      subject: string;
      connectionId?: string;
    }>;
    matchingLeasesForWorkspace?(connectionId: string, workspaceId: string): WorkspaceLease[];
    applyLease(lease: WorkspaceLease): void;
    revokeLease(leaseId: string): void;
    leaseForWorkspace(sessionId: string, workspaceId: string): WorkspaceLease | null;
    revokeWorkspaceAcrossMatching?(connectionId: string, workspaceId: string): void;
  };
}

function badRequest(message: string, code = 'INVALID_REQUEST', status = 400): Error {
  return Object.assign(new Error(message), { code, status });
}

export class ConnectionWorkspaceGrantService {
  constructor(private deps: ConnectionWorkspaceGrantDependencies) {}

  grant(input: ConnectionGrant): ConnectionGrantResult {
    const connectionId = String(input.connectionId ?? '').trim();
    const workspaceId = String(input.workspaceId ?? '').trim();
    const profileId = String(input.profileId ?? '').trim();

    if (!connectionId) throw badRequest('connectionId is required');
    if (!workspaceId) throw badRequest('workspaceId is required');
    if (!profileId) throw badRequest('profileId is required');

    const connection = this.deps.oauthRepo.getConnection(connectionId);
    if (!connection) throw badRequest('OAuth connection not found', 'NOT_FOUND', 404);
    if (connection.status !== 'ACTIVE') {
      throw badRequest('OAuth connection is not active', 'CONFLICT', 409);
    }

    const workspace = this.deps.workspaceRepo.get(workspaceId);
    if (!workspace) throw badRequest('workspace not found', 'NOT_FOUND', 404);

    const profile = this.deps.profiles.get(profileId);
    if (!profile) throw badRequest('profile not found', 'INVALID_REQUEST', 400);

    const matching = this.deps.sessions.matchingSessions(connectionId);
    const now = (this.deps.now ? this.deps.now() : new Date()).getTime();
    const idleMs = this.deps.idleMs ?? 30 * 60_000;
    const expiresAt = new Date(now + idleMs).toISOString();

    const preparedLeases: WorkspaceLease[] = [];
    const oldLeaseIdsToRevoke: string[] = [];
    const appliedSessionIds: string[] = [];

    for (const session of matching) {
      const existing = this.deps.sessions.leaseForWorkspace(session.id, workspaceId);
      if (existing) {
        oldLeaseIdsToRevoke.push(existing.id);
      }
      const newLease: WorkspaceLease = {
        id: `lease_${randomUUID()}`,
        sessionId: session.id,
        workspaceId,
        actor: session.actor,
        capabilities: [...profile.capabilities],
        expiresAt,
      };
      preparedLeases.push(newLease);
      appliedSessionIds.push(session.id);
    }

    const existingLeases =
      this.deps.sessions.matchingLeasesForWorkspace?.(connectionId, workspaceId) ?? [];
    for (const existing of existingLeases) {
      if (!oldLeaseIdsToRevoke.includes(existing.id)) {
        oldLeaseIdsToRevoke.push(existing.id);
        const newLease: WorkspaceLease = {
          id: `lease_${randomUUID()}`,
          sessionId: existing.sessionId,
          workspaceId,
          actor: existing.actor,
          capabilities: [...profile.capabilities],
          expiresAt: existing.expiresAt,
        };
        preparedLeases.push(newLease);
      }
    }

    this.deps.db.exec('BEGIN IMMEDIATE');
    try {
      this.deps.sessionRepo.rememberWorkspaceGrant(connectionId, workspaceId, profileId);
      for (const oldId of oldLeaseIdsToRevoke) {
        this.deps.sessionRepo.revokeLease(oldId);
      }
      for (const lease of preparedLeases) {
        this.deps.sessionRepo.saveLease(lease);
      }
      this.deps.db.exec('COMMIT');
    } catch (e) {
      this.deps.db.exec('ROLLBACK');
      throw e;
    }

    for (const oldId of oldLeaseIdsToRevoke) {
      this.deps.sessions.revokeLease(oldId);
    }
    for (const lease of preparedLeases) {
      this.deps.sessions.applyLease(lease);
    }

    return {
      grant: { connectionId, workspaceId, profileId },
      appliedSessionIds,
    };
  }

  remove(connectionId: string, workspaceId: string): { removed: boolean } {
    const connId = String(connectionId ?? '').trim();
    const wsId = String(workspaceId ?? '').trim();
    if (!connId || !wsId) return { removed: false };

    const connection = this.deps.oauthRepo.getConnection(connId);
    if (!connection) throw badRequest('OAuth connection not found', 'NOT_FOUND', 404);
    if (connection.status !== 'ACTIVE') {
      throw badRequest('OAuth connection is not active', 'CONFLICT', 409);
    }

    const leaseIdsToRevoke: string[] = [];
    if (this.deps.sessions.matchingLeasesForWorkspace) {
      for (const lease of this.deps.sessions.matchingLeasesForWorkspace(connId, wsId)) {
        leaseIdsToRevoke.push(lease.id);
      }
    } else {
      for (const session of this.deps.sessions.matchingSessions(connId)) {
        const lease = this.deps.sessions.leaseForWorkspace(session.id, wsId);
        if (lease) leaseIdsToRevoke.push(lease.id);
      }
    }

    this.deps.db.exec('BEGIN IMMEDIATE');
    let removed = false;
    try {
      removed = this.deps.sessionRepo.forgetWorkspaceGrant(connId, wsId);
      for (const oldId of leaseIdsToRevoke) {
        this.deps.sessionRepo.revokeLease(oldId);
      }
      this.deps.db.exec('COMMIT');
    } catch (e) {
      this.deps.db.exec('ROLLBACK');
      throw e;
    }

    for (const oldId of leaseIdsToRevoke) {
      this.deps.sessions.revokeLease(oldId);
    }
    this.deps.sessions.revokeWorkspaceAcrossMatching?.(connId, wsId);
    return { removed: removed || leaseIdsToRevoke.length > 0 };
  }

  list(connectionId: string): ConnectionGrant[] {
    const connId = String(connectionId ?? '').trim();
    if (!connId) return [];
    return this.deps.sessionRepo.listRememberedWorkspaceGrants(connId).map((row) => ({
      connectionId: row.subject,
      workspaceId: row.workspaceId,
      profileId: row.profileId,
    }));
  }
}
