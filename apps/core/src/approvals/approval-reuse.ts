import type { FrozenOperationTicket, SessionIdentityResolver } from './approval-service.js';

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
        !reusableStates.includes(ticket.state)
      )
        return false;
      if (
        (ticket.connectionSubject && ticket.connectionSubject === current.subject) ||
        (ticket.connectionId &&
          current.connectionId &&
          ticket.connectionId === current.connectionId)
      ) {
        return true;
      }
      const existing = resolveIdentity!(ticket.sessionId);
      return Boolean(
        existing && existing.actor === current.actor && existing.subject === current.subject,
      );
    }) ?? null
  );
}
