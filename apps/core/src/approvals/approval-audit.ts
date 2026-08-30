import type { AuditService } from '../audit/audit-service.js';
import type { FrozenOperationTicket } from './approval-service.js';

export function recordTicketDecision(
  audit: AuditService,
  ticket: FrozenOperationTicket,
  decision: string,
  result: string,
) {
  audit.append({
    actor: ticket.actor,
    sessionId: ticket.sessionId,
    workspaceId: ticket.workspaceId,
    operation: ticket.operation.family,
    risk: ticket.risk,
    decision,
    result,
    redactionCount: 0,
  });
}
