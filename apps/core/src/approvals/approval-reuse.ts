import type { FrozenOperationTicket, SessionIdentityResolver } from './approval-service.js';

function canResumeAcrossSessions(
  ticket: Pick<FrozenOperationTicket, 'state' | 'decisionScope' | 'sessionId'>,
  currentSessionId: string,
): boolean {
  if (ticket.sessionId === currentSessionId) return true;
  if (ticket.state === 'PENDING') return true;
  if (ticket.state === 'APPROVED') {
    return ticket.decisionScope === 'connection';
  }
  return false;
}

function isSameConnection(
  ticket: FrozenOperationTicket,
  current: { actor: string; subject: string; connectionId?: string },
  resolveIdentity?: SessionIdentityResolver,
): boolean {
  if (ticket.connectionSubject && ticket.connectionSubject === current.subject) return true;
  if (ticket.connectionId && current.connectionId && ticket.connectionId === current.connectionId)
    return true;
  if (resolveIdentity) {
    const existing = resolveIdentity(ticket.sessionId);
    if (existing && existing.actor === current.actor && existing.subject === current.subject) {
      return true;
    }
  }
  return false;
}

export function findReusableConnectionRequest(
  input: Omit<FrozenOperationTicket, 'id' | 'state' | 'expiresAt'>,
  listTickets: () => FrozenOperationTicket[],
  resolveIdentity?: SessionIdentityResolver,
) {
  if (
    (input.operation.family !== 'workspace:select' &&
      input.operation.family !== 'host-control:request') ||
    !input.actor.startsWith('oauth:') ||
    !resolveIdentity
  )
    return null;
  const current = resolveIdentity(input.sessionId);
  if (!current) return null;
  const reusableStates =
    input.operation.family === 'host-control:request' ? ['PENDING'] : ['PENDING', 'APPROVED'];
  return (
    listTickets().find((ticket) => {
      if (
        ticket.operation.family !== input.operation.family ||
        (input.scope !== 'host' && ticket.workspaceId !== input.workspaceId) ||
        (input.scope === 'host' &&
          (ticket.identity?.kind !== input.identity?.kind ||
            ticket.identity?.key !== input.identity?.key ||
            ticket.operation.capability !== input.operation.capability)) ||
        ticket.actor !== input.actor ||
        !reusableStates.includes(ticket.state) ||
        // A host-control request hashes the call that triggered it, but grants the
        // capability itself, so only workspace admission must match its arguments.
        (input.operation.family === 'workspace:select' &&
          ticket.operation.argsHash !== input.operation.argsHash)
      )
        return false;
      if (!isSameConnection(ticket, current, resolveIdentity)) return false;
      return canResumeAcrossSessions(ticket, input.sessionId);
    }) ?? null
  );
}
