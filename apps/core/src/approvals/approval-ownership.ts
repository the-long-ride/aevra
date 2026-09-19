import type { FrozenOperationTicket } from './approval-service.js';

export interface CallerApprovalIdentity {
  actor: string;
  sessionId: string;
  connectionId?: string;
  subject?: string;
}

export function isTicketOwnedByCaller(
  caller: CallerApprovalIdentity,
  ticket: Pick<FrozenOperationTicket, 'actor' | 'sessionId' | 'connectionId' | 'connectionSubject'>,
): boolean {
  if (caller.actor !== ticket.actor) {
    return false;
  }
  const isOAuth = caller.actor.startsWith('oauth:') && ticket.actor.startsWith('oauth:');
  if (isOAuth && (ticket.connectionId || ticket.connectionSubject)) {
    const targetSubject = ticket.connectionSubject ?? ticket.connectionId;
    const callerSubject = caller.subject ?? caller.connectionId;
    if (caller.connectionId && ticket.connectionId && caller.connectionId === ticket.connectionId) {
      return true;
    }
    if (callerSubject && targetSubject && callerSubject === targetSubject) {
      return true;
    }
    return false;
  }
  return caller.sessionId === ticket.sessionId;
}

export function assertTicketOwnership(
  caller: CallerApprovalIdentity,
  ticket: Pick<FrozenOperationTicket, 'actor' | 'sessionId' | 'connectionId' | 'connectionSubject'>,
): void {
  if (!isTicketOwnedByCaller(caller, ticket)) {
    throw Object.assign(new Error('approval not found'), { code: 'APPROVAL_NOT_FOUND' });
  }
}
