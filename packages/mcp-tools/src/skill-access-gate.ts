import type { SessionManager } from '../../../apps/core/src/sessions/session-manager.js';
import type {
  ApprovalService,
  FrozenOperationTicket,
} from '../../../apps/core/src/approvals/approval-service.js';
import { AevraToolError } from './errors.js';

const SKILL_TOOLS = new Set(['skills_list', 'skill_read', 'instructions_read']);
const SKILL_FAMILY = 'skills:read';
const SKILL_SCOPE = 'local-skills';

export interface SkillReadableMcpService {
  call(sessionId: string, name: string, args?: any): Promise<any>;
  resourcesList?(sessionId: string): { resources: any[] };
  resourceRead?(sessionId: string, uri: string): Promise<any>;
  promptsList?(): { prompts: any[] };
  promptGet?(sessionId: string): Promise<any>;
}

type AccessResult =
  | { granted: true }
  | {
      granted: false;
      result: {
        status: 'approval_pending';
        requestId: string;
        expiresInSeconds: number;
        scope: 'session';
        sources: ['user', 'workspace'];
        message: string;
      };
    };

export class SessionSkillAccessGate {
  private grantedSessions = new Set<string>();

  constructor(
    private inner: SkillReadableMcpService,
    private sessions: SessionManager,
    private approvals: ApprovalService,
  ) {}

  async call(sessionId: string, name: string, args: any = {}) {
    if (name === 'approval_wait') {
      const requestId = String(args?.requestId ?? '');
      const ticket = this.approvals.status(requestId);
      if (ticket?.operation.family === SKILL_FAMILY)
        return this.resumeSkillApproval(sessionId, requestId);
      return this.inner.call(sessionId, name, args);
    }
    if (SKILL_TOOLS.has(name)) {
      const access = await this.ensureSkillAccess(sessionId);
      if (!access.granted) return access.result;
    }
    return this.inner.call(sessionId, name, args);
  }

  resourcesList(sessionId: string) {
    if (!this.grantedSessions.has(sessionId)) return { resources: [] };
    return this.inner.resourcesList?.(sessionId) ?? { resources: [] };
  }

  async resourceRead(sessionId: string, uri: string) {
    const access = await this.ensureSkillAccess(sessionId);
    if (!access.granted)
      throw new AevraToolError(
        'APPROVAL_PENDING',
        'Local skills read access requires local approval',
        { requestId: access.result.requestId, scope: 'session' },
      );
    if (!this.inner.resourceRead)
      throw new AevraToolError('SKILL_NOT_FOUND', 'Skills are not configured');
    return this.inner.resourceRead(sessionId, uri);
  }

  promptsList() {
    return this.inner.promptsList?.() ?? { prompts: [] };
  }

  async promptGet(sessionId: string) {
    const access = await this.ensureSkillAccess(sessionId);
    if (!access.granted)
      throw new AevraToolError(
        'APPROVAL_PENDING',
        'Local skills read access requires local approval',
        { requestId: access.result.requestId, scope: 'session' },
      );
    if (!this.inner.promptGet)
      throw new AevraToolError('INVALID_REQUEST', 'Skills are not configured');
    return this.inner.promptGet(sessionId);
  }

  private async ensureSkillAccess(sessionId: string): Promise<AccessResult> {
    if (this.grantedSessions.has(sessionId)) return { granted: true };
    const session = this.sessions.get(sessionId);
    if (!session) throw new AevraToolError('UNAUTHORIZED', 'Unknown Aevra session');

    const existing = [...this.approvals.list()]
      .reverse()
      .find((ticket) => ticket.sessionId === sessionId && ticket.operation.family === SKILL_FAMILY);
    if (existing) {
      const latest = this.approvals.status(existing.id) ?? existing;
      if (latest.state === 'APPROVED') {
        await this.resumeSkillApproval(sessionId, latest.id);
        return { granted: true };
      }
      if (latest.state === 'SUCCEEDED') {
        this.grantedSessions.add(sessionId);
        return { granted: true };
      }
      if (latest.state === 'DENIED')
        throw new AevraToolError(
          'APPROVAL_DENIED',
          'Local skills read access was denied for this MCP session',
        );
      if (latest.state === 'PENDING') return { granted: false, result: this.pendingResult(latest) };
    }

    const request = await this.approvals.request({
      actor: session.actor,
      sessionId,
      workspaceId: SKILL_SCOPE,
      operation: {
        family: SKILL_FAMILY,
        capability: 'files.read',
        risk: 'MEDIUM',
        argsHash: 'session-local-skills-read-v1',
      },
      payload: { tool: 'skills_access', scope: 'session', sources: ['user', 'workspace'] },
      expectedState: { sessionId },
      risk: 'MEDIUM',
    });
    if (request.status === 'approved') {
      await this.resumeSkillApproval(sessionId, request.requestId);
      return { granted: true };
    }
    const ticket = this.approvals.status(request.requestId);
    if (!ticket)
      throw new AevraToolError('APPROVAL_PENDING', 'Local skills approval request was not found');
    return { granted: false, result: this.pendingResult(ticket) };
  }

  private async resumeSkillApproval(sessionId: string, requestId: string) {
    const ticket = this.approvals.status(requestId);
    if (!ticket) return null;
    if (ticket.operation.family !== SKILL_FAMILY)
      return this.inner.call(sessionId, 'approval_wait', { requestId });
    if (ticket.state !== 'APPROVED') return ticket;
    return this.approvals.resume(
      requestId,
      async (current) => {
        const session = this.sessions.get(sessionId);
        if (!session || session.id !== current.sessionId || session.actor !== current.actor)
          return { ok: false, reason: 'session changed' };
        return { ok: true };
      },
      async () => {
        this.grantedSessions.add(sessionId);
        return {
          status: 'skill_access_granted',
          scope: 'session',
          sources: ['user', 'workspace'] as const,
        };
      },
    );
  }

  private pendingResult(ticket: FrozenOperationTicket) {
    return {
      status: 'approval_pending' as const,
      requestId: ticket.id,
      expiresInSeconds: Math.max(0, Math.ceil((Date.parse(ticket.expiresAt) - Date.now()) / 1000)),
      scope: 'session' as const,
      sources: ['user', 'workspace'] as ['user', 'workspace'],
      message: 'Approve local Aevra skills and instructions once for this MCP session.',
    };
  }
}
