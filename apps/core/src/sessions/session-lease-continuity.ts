import { randomUUID } from 'node:crypto';
import type { Clock } from '../../../../packages/protocol/src/index.js';
import type { SessionRepository } from '../../../../packages/store/src/sessions.js';
import type { VerifiedRemoteIdentity } from '../auth/cloudflare.js';
import type { SecuritySession, WorkspaceLease } from './session-types.js';

export function isConnectorSessionActor(actor: string) {
  return actor.startsWith('connector:') || actor.startsWith('oauth:');
}

export function rebindDetachedLeases(input: {
  sessionIds: string[];
  session: SecuritySession;
  leaseRows: Map<string, WorkspaceLease>;
  repo: SessionRepository;
  clock: Clock;
  leaseForWorkspace: (sessionId: string, workspaceId: string) => WorkspaceLease | null;
  revokeLease: (leaseId: string) => void;
}) {
  const now = input.clock.now().getTime();
  for (const oldSessionId of input.sessionIds) {
    const leases = [...input.leaseRows.values()].filter(
      (lease) => lease.sessionId === oldSessionId,
    );
    for (const lease of leases) {
      if (
        Date.parse(lease.expiresAt) <= now ||
        input.leaseForWorkspace(input.session.id, lease.workspaceId)
      ) {
        input.revokeLease(lease.id);
        continue;
      }
      const rebound: WorkspaceLease = {
        ...lease,
        id: `lease_${randomUUID()}`,
        sessionId: input.session.id,
        actor: input.session.actor,
        capabilities: [...lease.capabilities],
      };
      input.leaseRows.set(rebound.id, rebound);
      input.repo.saveLease(rebound);
      input.revokeLease(lease.id);
    }
  }
}

export function detachedSessionIds(
  identities: Map<string, { actor: string; subject: string; connectionId?: string }>,
  identity: VerifiedRemoteIdentity,
) {
  return [...identities.entries()]
    .filter(
      ([, value]) =>
        value.actor === identity.actor &&
        value.subject === identity.subject &&
        value.connectionId === identity.connectionId,
    )
    .map(([sessionId]) => sessionId);
}

export function restoreRememberedWorkspaces(
  repo: SessionRepository,
  session: SecuritySession,
  admitWorkspace: (workspaceId: string, profileId: string) => unknown,
) {
  if (!session.actor.startsWith('oauth:')) return;
  for (const grant of repo.listRememberedWorkspaceGrants(session.subject)) {
    try {
      admitWorkspace(grant.workspaceId, grant.profileId);
    } catch {
      /* stale grant; later admission can repair it */
    }
  }
}

export function grantRememberedWorkspaceAcrossSessions(input: {
  repo: SessionRepository;
  sessions: Iterable<SecuritySession>;
  source: Pick<SecuritySession, 'actor' | 'subject'> & Partial<Pick<SecuritySession, 'id'>>;
  workspaceId: string;
  profileId: string;
  admitWorkspace: (
    sessionId: string,
    workspaceId: string,
    profileId: string,
  ) => { status: 'admitted'; lease: WorkspaceLease } | { status: 'approval-required' };
}) {
  input.repo.rememberWorkspaceGrant(input.source.subject, input.workspaceId, input.profileId);
  let granted: WorkspaceLease | null = null;
  for (const session of input.sessions) {
    if (session.actor !== input.source.actor || session.subject !== input.source.subject) continue;
    const admitted = input.admitWorkspace(session.id, input.workspaceId, input.profileId);
    if (admitted.status !== 'admitted') {
      throw new Error('connection workspace grant could not be admitted');
    }
    if (session.id === input.source.id || !granted) granted = admitted.lease;
  }
  return granted;
}

export function revokeConnectionSessions(input: {
  connectionId: string;
  sessions: Iterable<SecuritySession>;
  disconnectedIdentities: Iterable<[string, { connectionId?: string }]>;
  disconnect: (sessionId: string) => void;
  revokeSession: (sessionId: string) => void;
}) {
  const ids = new Set<string>();
  for (const session of input.sessions) {
    if (session.connectionId === input.connectionId) ids.add(session.id);
  }
  for (const [sessionId, identity] of input.disconnectedIdentities) {
    if (identity.connectionId === input.connectionId) ids.add(sessionId);
  }
  for (const sessionId of ids) {
    input.disconnect(sessionId);
    input.revokeSession(sessionId);
  }
}

export function revokeWorkspaceAccess(input: {
  repo: SessionRepository;
  sessions: Map<string, SecuritySession>;
  sessionId: string;
  workspaceId: string;
  leaseForWorkspace: (sessionId: string, workspaceId: string) => WorkspaceLease | null;
  revokeLease: (leaseId: string) => void;
}) {
  const session = input.sessions.get(input.sessionId);
  if (!session) return false;
  if (session.actor.startsWith('oauth:')) {
    return revokeRememberedWorkspaceAcrossSessions({
      repo: input.repo,
      sessions: input.sessions.values(),
      source: session,
      workspaceId: input.workspaceId,
      leaseForWorkspace: input.leaseForWorkspace,
      revokeLease: input.revokeLease,
    });
  }
  const lease = input.leaseForWorkspace(input.sessionId, input.workspaceId);
  if (!lease) return false;
  input.revokeLease(lease.id);
  return true;
}
export function revokeRememberedWorkspaceAcrossSessions(input: {
  repo: SessionRepository;
  sessions: Iterable<SecuritySession>;
  source: SecuritySession;
  workspaceId: string;
  leaseForWorkspace: (sessionId: string, workspaceId: string) => WorkspaceLease | null;
  revokeLease: (leaseId: string) => void;
}) {
  let changed = input.repo.forgetWorkspaceGrant(input.source.subject, input.workspaceId);
  for (const session of input.sessions) {
    if (session.actor !== input.source.actor || session.subject !== input.source.subject) continue;
    const lease = input.leaseForWorkspace(session.id, input.workspaceId);
    if (!lease) continue;
    input.revokeLease(lease.id);
    changed = true;
  }
  return changed;
}
