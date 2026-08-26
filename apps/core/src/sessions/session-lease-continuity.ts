import { randomUUID } from 'node:crypto';
import type { Clock } from '../../../../packages/protocol/src/index.js';
import type { SessionRepository } from '../../../../packages/store/src/sessions.js';
import type { VerifiedRemoteIdentity } from '../auth/cloudflare.js';
import type { SecuritySession, WorkspaceLease } from './session-types.js';

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
