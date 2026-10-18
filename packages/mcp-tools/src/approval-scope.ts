import type { AevraErrorCode } from '../../../packages/protocol/src/index.js';
import type { FrozenOperationTicket } from '../../../apps/core/src/approvals/approval-service.js';
import { sameConnection } from './service-helpers.js';
import type { McpRuntimeContext } from './service-types.js';

function validateTicketAuthority(
  context: McpRuntimeContext,
  sessionId: string,
  ticket: FrozenOperationTicket,
  options: { sessionBound?: boolean; requireWorkspace?: boolean } = {},
): { ok: true } | { ok: false; reason: string; code?: AevraErrorCode } {
  const session = context.sessions.get(sessionId);
  if (!session) return { ok: false, reason: 'session changed' };
  if (ticket.actor.startsWith('oauth:')) {
    if (options.sessionBound && ticket.decisionScope !== 'connection') {
      if (session.id !== ticket.sessionId || session.actor !== ticket.actor) {
        if (sameConnection(context, sessionId, ticket)) {
          return {
            ok: false,
            reason: 'approval scope mismatch',
            code: 'APPROVAL_SCOPE_MISMATCH',
          };
        }
        return { ok: false, reason: 'session changed' };
      }
    } else if (!sameConnection(context, sessionId, ticket)) {
      return { ok: false, reason: 'OAuth connection changed' };
    }
  } else if (session.id !== ticket.sessionId || session.actor !== ticket.actor) {
    return { ok: false, reason: 'session changed' };
  }
  if (
    (options.requireWorkspace || ticket.workspaceId) &&
    (!ticket.workspaceId || !context.workspaces.getLocal(ticket.workspaceId))
  ) {
    return { ok: false, reason: 'workspace no longer exists' };
  }
  return { ok: true };
}

export function validateAdmissionAuthority(
  context: McpRuntimeContext,
  sessionId: string,
  ticket: FrozenOperationTicket,
) {
  return validateTicketAuthority(context, sessionId, ticket, { sessionBound: true });
}

export function validateCapabilityAuthority(
  context: McpRuntimeContext,
  sessionId: string,
  ticket: FrozenOperationTicket,
) {
  return validateTicketAuthority(context, sessionId, ticket, {
    sessionBound: false,
    requireWorkspace: true,
  });
}
