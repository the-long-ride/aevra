import { createHash } from 'node:crypto';
import type { SessionManager } from '../sessions/session-manager.js';
import type { ApprovalService, FrozenOperationTicket } from '../approvals/approval-service.js';
import type { HostControlCapability } from '../../../../packages/store/src/host-control-grants.js';
import { HostControlAccess } from './host-control-access.js';

export class HostControlApproval {
  constructor(
    private sessions: Pick<SessionManager, 'connectionIdentity' | 'connectionState'>,
    private access: HostControlAccess,
    private approvals: ApprovalService,
  ) {
    this.approvals.addBeforeApprovedHandler((ticket) => this.validateApproved(ticket));
    this.approvals.addApprovedHandler((ticket) => this.grantApproved(ticket));
  }
  async requestHostControl(
    sessionId: string,
    capability: HostControlCapability,
    originalCall: { tool: string; args: unknown },
  ) {
    if (this.access.has(sessionId, capability)) return { status: 'approved' as const };
    const identity = this.access.identity(sessionId);
    const caller = this.sessions.connectionIdentity(sessionId);
    if (!identity || !caller) throw new Error('UNAUTHORIZED');
    const argsHash = createHash('sha256').update(JSON.stringify(originalCall)).digest('hex');
    return this.approvals.request({
      actor: caller.actor,
      sessionId,
      workspaceId: '',
      scope: 'host',
      identity,
      operation: { family: 'host-control:request', capability, risk: 'HIGH', argsHash },
      payload: { tool: 'host_control_request', capability, originalTool: originalCall.tool },
      expectedState: {},
      risk: 'HIGH',
    });
  }
  canResume(sessionId: string, requestId: string) {
    const ticket = this.approvals.status(requestId);
    const identity = this.access.identity(sessionId);
    return Boolean(
      ticket?.scope === 'host' &&
      identity &&
      ticket.identity?.kind === identity.kind &&
      ticket.identity?.key === identity.key,
    );
  }
  private validateApproved(ticket: FrozenOperationTicket) {
    if (ticket.scope !== 'host') return;
    if (
      !ticket.identity ||
      !this.access.isActive(ticket.identity) ||
      (ticket.identity.kind === 'oauth' &&
        this.sessions.connectionState(ticket.identity.key)?.status !== 'CONNECTED' &&
        this.sessions.connectionState(ticket.identity.key)?.status !== 'GRACE' &&
        this.sessions.connectionState(ticket.identity.key)?.status !== 'OFFLINE')
    ) {
      throw new Error('Host control connection was revoked');
    }
  }
  private grantApproved(ticket: FrozenOperationTicket) {
    if (
      ticket.scope !== 'host' ||
      ticket.operation.family !== 'host-control:request' ||
      !ticket.identity
    )
      return;
    if (
      ticket.identity.kind === 'oauth' &&
      this.sessions.connectionState(ticket.identity.key)?.status === 'REVOKED'
    )
      return;
    this.access.grant(
      ticket.identity,
      ticket.operation.capability as HostControlCapability,
      'local-approval',
    );
  }
}
