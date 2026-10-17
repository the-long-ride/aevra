import { randomUUID } from 'node:crypto';
import type { Clock } from '../../../../packages/protocol/src/index.js';
import type { SessionRepository } from '../../../../packages/store/src/sessions.js';
import type { VerifiedRemoteIdentity } from '../auth/cloudflare.js';
import type { ConnectionStateStore } from './connection-state.js';
import type { DisconnectedIdentity, SecuritySession, WorkspaceLease } from './session-types.js';

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
  disconnectedIdentities: Iterable<[string, { connectionId?: string; subject?: string }]>;
  disconnect: (sessionId: string) => void;
  revokeSession: (sessionId: string) => void;
}) {
  const ids = new Set<string>();
  for (const session of input.sessions) {
    if (session.connectionId === input.connectionId || session.subject === input.connectionId) {
      ids.add(session.id);
    }
  }
  for (const [sessionId, identity] of input.disconnectedIdentities) {
    if (identity.connectionId === input.connectionId || identity.subject === input.connectionId) {
      ids.add(sessionId);
    }
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
function revokeRememberedWorkspaceAcrossSessions(input: {
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

export function findMatchingConnectionSessions(
  sessions: Iterable<SecuritySession>,
  connectionId: string,
): SecuritySession[] {
  return [...sessions].filter((s) => s.connectionId === connectionId || s.subject === connectionId);
}

export function findMatchingDetachedIdentities(
  identities: Iterable<[string, { actor: string; subject: string; connectionId?: string }]>,
  connectionId: string,
): Array<{ sessionId: string; actor: string; subject: string; connectionId?: string }> {
  return [...identities]
    .filter(([, id]) => id.connectionId === connectionId || id.subject === connectionId)
    .map(([sessionId, id]) => ({ sessionId, ...id }));
}

export function findMatchingConnectionLeases(input: {
  sessions: Iterable<SecuritySession>;
  disconnectedIdentities: Iterable<[string, { connectionId?: string; subject?: string }]>;
  leaseRows: Iterable<WorkspaceLease>;
  connectionId: string;
  workspaceId: string;
}): WorkspaceLease[] {
  const ids = new Set<string>();
  for (const s of input.sessions) {
    if (s.connectionId === input.connectionId || s.subject === input.connectionId) ids.add(s.id);
  }
  for (const [id, ident] of input.disconnectedIdentities) {
    if (ident.connectionId === input.connectionId || ident.subject === input.connectionId)
      ids.add(id);
  }
  return [...input.leaseRows].filter(
    (l) => l.workspaceId === input.workspaceId && ids.has(l.sessionId),
  );
}

export interface SessionContext {
  sessions: Map<string, SecuritySession>;
  disconnectedIdentities: Map<string, DisconnectedIdentity>;
  leaseRows: Map<string, WorkspaceLease>;
  yoloSessions: Set<string>;
  pendingRememberedRestore: Set<string>;
  connections?: ConnectionStateStore;
  repo: SessionRepository;
  reconnectGraceMs: number;
  clock?: Clock;
}

export function disconnectSessionImmediate(
  ctx: Pick<
    SessionContext,
    | 'sessions'
    | 'disconnectedIdentities'
    | 'leaseRows'
    | 'yoloSessions'
    | 'pendingRememberedRestore'
    | 'connections'
    | 'clock'
  >,
  sessionId: string,
  rememberIdentity: boolean,
  revokeLease: (id: string) => void,
) {
  const session = ctx.sessions.get(sessionId);
  if (rememberIdentity && session) {
    ctx.disconnectedIdentities.set(sessionId, {
      actor: session.actor,
      subject: session.subject,
      ...(session.connectionId ? { connectionId: session.connectionId } : {}),
      disconnectedAt: (ctx.clock?.now() ?? new Date()).toISOString(),
    });
  } else if (!rememberIdentity) {
    ctx.disconnectedIdentities.delete(sessionId);
  }
  const leases = [...ctx.leaseRows.values()].filter((l) => l.sessionId === sessionId);
  for (const lease of leases) revokeLease(lease.id);
  ctx.yoloSessions.delete(sessionId);
  ctx.pendingRememberedRestore.delete(sessionId);
  ctx.sessions.delete(sessionId);
  ctx.connections?.forgetSession(sessionId);
}

export function invalidateWorkspaceAccess(input: {
  repo: SessionRepository;
  leaseRows: Iterable<WorkspaceLease>;
  workspaceId: string;
  revokeLease: (id: string) => void;
}) {
  for (const lease of [...input.leaseRows]) {
    if (lease.workspaceId === input.workspaceId) input.revokeLease(lease.id);
  }
  input.repo.revokeWorkspaceLeases?.(input.workspaceId);
  input.repo.forgetWorkspaceGrants?.(input.workspaceId);
}

export function detachSession(
  ctx: SessionContext,
  sessionId: string,
  revokeLease: (id: string) => void,
) {
  const session = ctx.sessions.get(sessionId);
  if (!session) return;
  if (session.actor.startsWith('oauth:') && session.connectionId && ctx.connections) {
    ctx.disconnectedIdentities.set(sessionId, {
      actor: session.actor,
      subject: session.subject,
      connectionId: session.connectionId,
      disconnectedAt: (ctx.clock?.now() ?? new Date()).toISOString(),
    });
    ctx.connections.detach(sessionId, ctx.reconnectGraceMs);
    ctx.repo.detach(sessionId);
    ctx.yoloSessions.delete(sessionId);
    ctx.pendingRememberedRestore.delete(sessionId);
    ctx.sessions.delete(sessionId);
    return;
  }
  disconnectSessionImmediate(ctx, sessionId, session.actor.startsWith('oauth:'), revokeLease);
}

export function expireGraceSessionConnections(
  ctx: Pick<SessionContext, 'connections' | 'disconnectedIdentities'>,
  disconnectImmediate: (sessionId: string, rememberIdentity: boolean) => void,
) {
  if (!ctx.connections) return;
  const expired = new Set(ctx.connections.expireGraceConnections());
  if (!expired.size) return;
  for (const [sessionId, identity] of [...ctx.disconnectedIdentities]) {
    if (identity.connectionId && expired.has(identity.connectionId)) {
      disconnectImmediate(sessionId, false);
    }
  }
}
