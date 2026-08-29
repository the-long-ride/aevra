import type { SessionManager } from '../../../apps/core/src/sessions/session-manager.js';
import type {
  ApprovalService,
  FrozenOperationTicket,
} from '../../../apps/core/src/approvals/approval-service.js';
import { renderInstructionPrompt } from './instruction-prompt.js';
import { AevraToolError } from './errors.js';

const SKILL_READ_TOOLS = new Set(['skills_list', 'skill_read', 'instructions_read']);
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
    }
    if (SKILL_READ_TOOLS.has(name) && !this.sessions.activeLease(sessionId)) {
      const access = await this.ensureSkillAccess(sessionId);
      if (!access.granted) return access.result;
    }
    return this.inner.call(sessionId, name, args);
  }

  resourcesList(sessionId: string) {
    const lease = this.sessions.activeLease(sessionId);
    const workspaceCanReadSkills = lease?.capabilities.includes('skills.read') ?? false;
    if (
      !workspaceCanReadSkills &&
      !this.grantedSessions.has(sessionId) &&
      !this.sessions.isYolo(sessionId)
    ) {
      return { resources: [] };
    }
    return this.inner.resourcesList?.(sessionId) ?? { resources: [] };
  }

  async resourceRead(sessionId: string, uri: string) {
    if (!this.sessions.activeLease(sessionId)) {
      const access = await this.ensureSkillAccess(sessionId);
      if (!access.granted)
        throw new AevraToolError(
          'APPROVAL_PENDING',
          'Local skill resource access requires local approval',
          { requestId: access.result.requestId, scope: 'session' },
        );
    }
    const match = String(uri).match(/^aevra:\/\/skill\/(user|workspace)\/([^/]+)$/);
    if (!match) throw new AevraToolError('INVALID_REQUEST', 'Unknown resource URI');
    const read = await this.inner.call(sessionId, 'skill_read', {
      source: match[1],
      name: decodeURIComponent(match[2]!),
    });
    this.throwIfApprovalPending(read, 'Local skill resource access requires capability approval');
    if (!read || typeof read.content !== 'string')
      throw new AevraToolError('SKILL_NOT_FOUND', 'Skill content is unavailable');
    return {
      uri,
      contents: [{ uri, mimeType: 'text/markdown', text: read.content }],
    };
  }

  promptsList() {
    return this.inner.promptsList?.() ?? { prompts: [] };
  }

  async promptGet(sessionId: string) {
    if (!this.sessions.activeLease(sessionId)) {
      const access = await this.ensureSkillAccess(sessionId);
      if (!access.granted)
        throw new AevraToolError(
          'APPROVAL_PENDING',
          'Local instruction prompt access requires local approval',
          { requestId: access.result.requestId, scope: 'session' },
        );
    }
    const result = await this.inner.call(sessionId, 'instructions_read', {});
    this.throwIfApprovalPending(
      result,
      'Local instruction prompt access requires capability approval',
    );
    return {
      description: 'Aevra instructions',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: renderInstructionPrompt(result?.instructions, result?.note),
          },
        },
      ],
    };
  }

  private throwIfApprovalPending(result: any, message: string) {
    if (result?.status !== 'approval_pending') return;
    throw new AevraToolError('APPROVAL_PENDING', message, {
      requestId: result.requestId,
      scope: result.scope ?? 'session',
    });
  }

  private async ensureSkillAccess(sessionId: string): Promise<AccessResult> {
    if (this.sessions.isYolo(sessionId)) return { granted: true };
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
          'Local skill resource access was denied for this MCP session',
        );
      if (latest.state === 'PENDING') return { granted: false, result: this.pendingResult(latest) };
    }

    const request = await this.approvals.request({
      actor: session.actor,
      sessionId,
      workspaceId: SKILL_SCOPE,
      operation: {
        family: SKILL_FAMILY,
        capability: 'skills.read',
        risk: 'MEDIUM',
        argsHash: 'session-local-skills-read-v2',
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
      message:
        'Approve passive local Aevra skill resources and instruction prompts for this MCP session.',
    };
  }
}
