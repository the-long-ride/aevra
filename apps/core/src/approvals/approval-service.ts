import { randomUUID } from 'node:crypto';
import type { RiskTier, NormalizedOperation } from '../../../../packages/protocol/src/index.js';
import type { ApprovalRepository } from '../../../../packages/store/src/approvals.js';
import type { AuditService } from '../audit/audit-service.js';
import { notifySystem } from '../../../../packages/notifications/src/notify.js';
import { recordTicketDecision } from './approval-audit.js';
import { presentApproval } from './request-presentation.js';

export type ApprovalState =
  | 'PENDING'
  | 'APPROVED'
  | 'DENIED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'EXECUTING'
  | 'CONTEXT_CHANGED'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'INTERRUPTED';
export interface FrozenOperationTicket {
  id: string;
  actor: string;
  sessionId: string;
  workspaceId: string;
  operation: NormalizedOperation;
  payload?: unknown;
  expectedState: Record<string, string>;
  risk: RiskTier;
  state: ApprovalState;
  expiresAt: string;
  createdAt?: string;
  cancellationReason?: string;
  decisionScope?: string;
}
export interface ApprovalConfig {
  fastWaitMs: number;
  lifetimeMs: number;
  lifetimeByRiskMs: Partial<Record<RiskTier, number>>;
}
export type ResumeRevalidator = (
  ticket: FrozenOperationTicket,
) => Promise<{ ok: true } | { ok: false; reason: string }>;
export type ApprovedHandler = (ticket: FrozenOperationTicket) => void;
export type SessionIdentityResolver = (
  sessionId: string,
) => { actor: string; subject: string } | null;

export class ApprovalService {
  private approvedHandler?: ApprovedHandler;
  private sessionIdentityResolver?: SessionIdentityResolver;
  private volatilePayloads = new Map<string, unknown>();
  constructor(
    private repo: ApprovalRepository,
    private audit: AuditService,
    private config: ApprovalConfig,
  ) {}

  setApprovedHandler(handler: ApprovedHandler) {
    this.approvedHandler = handler;
  }
  setSessionIdentityResolver(resolver: SessionIdentityResolver) {
    this.sessionIdentityResolver = resolver;
  }

  private record(ticket: FrozenOperationTicket, decision: string, result: string) {
    recordTicketDecision(this.audit, ticket, decision, result);
  }

  async request(input: Omit<FrozenOperationTicket, 'id' | 'state' | 'expiresAt'>) {
    const reusable = this.reusableConnectionRequest(input);
    if (reusable) {
      const latest = this.status(reusable.id);
      if (latest?.state === 'APPROVED')
        return { status: 'approved' as const, requestId: latest.id };
      if (latest?.state === 'PENDING')
        return {
          status: 'approval_pending' as const,
          requestId: latest.id,
          expiresInSeconds: Math.max(
            0,
            Math.ceil((Date.parse(latest.expiresAt) - Date.now()) / 1000),
          ),
        };
    }
    const lifetime = this.config.lifetimeByRiskMs[input.risk] ?? this.config.lifetimeMs;
    const t: FrozenOperationTicket = {
      ...input,
      id: `req_${randomUUID()}`,
      state: 'PENDING',
      expiresAt: new Date(Date.now() + lifetime).toISOString(),
      createdAt: new Date().toISOString(),
    };
    const stored = this.repo.put(t) as FrozenOperationTicket;
    if (
      input.payload !== undefined &&
      JSON.stringify(stored.payload) !== JSON.stringify(input.payload)
    ) {
      this.volatilePayloads.set(t.id, input.payload);
    }
    this.record(t, 'approval_requested', 'pending');
    const view = presentApproval(stored),
      parts = [view.action, view.target, view.preview].filter(Boolean);
    notifySystem(`Aevra: ${view.title}`, parts.join(' · '));
    if (this.config.fastWaitMs > 0) await new Promise((r) => setTimeout(r, this.config.fastWaitMs));
    const latest = this.status(t.id)!;
    if (latest.state === 'APPROVED') return { status: 'approved' as const, requestId: t.id };
    return {
      status: 'approval_pending' as const,
      requestId: t.id,
      expiresInSeconds: Math.max(0, Math.ceil((Date.parse(t.expiresAt) - Date.now()) / 1000)),
    };
  }

  list() {
    return (this.repo.list().filter(Boolean) as FrozenOperationTicket[]).map((ticket) => ({
      ...ticket,
      presentation: presentApproval(ticket),
    }));
  }
  status(id: string): FrozenOperationTicket | null {
    const t = this.repo.get(id) as FrozenOperationTicket | null;
    if (t && ['PENDING', 'APPROVED'].includes(t.state) && Date.parse(t.expiresAt) <= Date.now()) {
      t.state = 'EXPIRED';
      this.repo.put(t);
      this.volatilePayloads.delete(t.id);
      this.record(t, 'expired', 'APPROVAL_TIMEOUT');
    }
    return t;
  }
  approve(id: string, scope = 'once') {
    const t = this.required(id);
    if (t.state !== 'PENDING') throw new Error(`Cannot approve ${t.state}`);
    if (t.risk === 'CRITICAL' && scope !== 'once')
      throw new Error('Critical operations only support one-time local approval');
    if ((t.payload as any)?.securityOnce === true && scope !== 'once')
      throw new Error('Security-sensitive operations only support one-time local approval');
    // Command matchers collapse positional arguments to `*`, so a standing grant
    // authorizes far more than the command that was actually reviewed: the shell
    // matcher `shell:<shell>:*` excludes the script body entirely, and approving
    // `rm -rf ./build` stores `rm:-rf:*`, which covers any other path too.
    if (t.operation.capability === 'commands.run' && scope !== 'once') {
      if (t.operation.family.startsWith('shell:'))
        throw new Error('Shell execution only supports one-time local approval');
      if (t.operation.risk === 'HIGH')
        throw new Error('High-risk commands only support one-time local approval');
    }
    if (t.operation.family === 'skills:read' && scope !== 'once')
      throw new Error(
        'This request is connection/session scoped and only supports one-time local approval',
      );
    if (t.operation.family === 'workspace:select' && t.actor.startsWith('connector:')) {
      const payload = t.payload as any;
      if (payload?.tool === 'workspace_select' && payload.profileId === 'developer')
        t.payload = { ...payload, profileId: 'read-only' };
    }
    t.state = 'APPROVED';
    t.decisionScope = scope;
    this.repo.put(t);
    this.record(t, `approved:${scope}`, 'armed');
    this.approvedHandler?.(t);
    return t;
  }
  deny(id: string) {
    const t = this.required(id);
    if (t.state !== 'PENDING') throw new Error(`Cannot deny ${t.state}`);
    t.state = 'DENIED';
    this.repo.put(t);
    this.volatilePayloads.delete(t.id);
    this.record(t, 'denied', 'APPROVAL_DENIED');
    return t;
  }
  cancel(id: string, reason = 'client_cancelled') {
    const t = this.required(id);
    if (!['PENDING', 'APPROVED'].includes(t.state)) throw new Error(`Cannot cancel ${t.state}`);
    t.state = 'CANCELLED';
    t.cancellationReason = reason;
    this.repo.put(t);
    this.volatilePayloads.delete(t.id);
    this.record(t, 'cancelled', reason);
    return t;
  }
  cancelForRestart() {
    for (const t of this.repo.list().filter(Boolean) as FrozenOperationTicket[])
      if (['PENDING', 'APPROVED'].includes(t.state)) {
        t.state = 'CANCELLED';
        t.cancellationReason = 'CANCELLED_RESTART';
        this.repo.put(t);
        this.volatilePayloads.delete(t.id);
        this.record(t, 'cancelled', 'CANCELLED_RESTART');
      }
    this.volatilePayloads.clear();
  }

  async resume<T>(
    id: string,
    revalidate: ResumeRevalidator,
    execute: (ticket: FrozenOperationTicket) => Promise<T>,
  ) {
    const stored = this.required(id);
    if (stored.state === 'EXPIRED')
      throw Object.assign(new Error('APPROVAL_TIMEOUT'), { code: 'APPROVAL_TIMEOUT' });
    if (stored.state !== 'APPROVED')
      throw Object.assign(new Error(`Approval is ${stored.state}`), {
        code: stored.state === 'DENIED' ? 'APPROVAL_DENIED' : 'APPROVAL_PENDING',
      });
    const t = this.withVolatilePayload(stored);
    const valid = await revalidate(t);
    if (!valid.ok) {
      t.state = 'CONTEXT_CHANGED';
      this.repo.put(t);
      this.volatilePayloads.delete(t.id);
      this.record(t, 'resume_rejected', 'APPROVAL_CONTEXT_CHANGED');
      throw Object.assign(new Error(valid.reason), { code: 'APPROVAL_CONTEXT_CHANGED' });
    }
    t.state = 'EXECUTING';
    this.repo.put(t);
    this.record(t, 'resume', 'EXECUTING');
    try {
      const result = await execute(t);
      t.state = 'SUCCEEDED';
      this.repo.put(t);
      this.volatilePayloads.delete(t.id);
      this.record(t, 'resume', 'SUCCEEDED');
      return result;
    } catch (e) {
      t.state = 'FAILED';
      this.repo.put(t);
      this.volatilePayloads.delete(t.id);
      this.record(t, 'resume', 'FAILED');
      throw e;
    }
  }

  private withVolatilePayload(ticket: FrozenOperationTicket): FrozenOperationTicket {
    if (!this.volatilePayloads.has(ticket.id)) return ticket;
    return { ...ticket, payload: this.volatilePayloads.get(ticket.id) };
  }

  private reusableConnectionRequest(
    input: Omit<FrozenOperationTicket, 'id' | 'state' | 'expiresAt'>,
  ) {
    if (
      input.operation.family !== 'workspace:select' ||
      !input.actor.startsWith('oauth:') ||
      !this.sessionIdentityResolver
    )
      return null;
    const current = this.sessionIdentityResolver(input.sessionId);
    if (!current) return null;
    return (
      (this.repo.list().filter(Boolean) as FrozenOperationTicket[]).find((ticket) => {
        if (
          ticket.operation.family !== input.operation.family ||
          ticket.workspaceId !== input.workspaceId ||
          ticket.actor !== input.actor ||
          !['PENDING', 'APPROVED'].includes(ticket.state)
        )
          return false;
        const existing = this.sessionIdentityResolver!(ticket.sessionId);
        return Boolean(
          existing && existing.actor === current.actor && existing.subject === current.subject,
        );
      }) ?? null
    );
  }
  private required(id: string) {
    const t = this.status(id);
    if (!t) throw new Error('approval not found');
    return t;
  }
}
