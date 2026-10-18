import type {
  RiskTier,
  NormalizedOperation,
  AevraErrorCode,
} from '../../../../packages/protocol/src/index.js';
import type { HostControlIdentity } from '../../../../packages/store/src/host-control-grants.js';

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
  scope?: 'workspace' | 'host';
  identity?: HostControlIdentity;
  operation: NormalizedOperation;
  payload?: unknown;
  expectedState: Record<string, string>;
  risk: RiskTier;
  state: ApprovalState;
  expiresAt: string;
  createdAt?: string;
  cancellationReason?: string;
  decisionScope?: string;
  connectionId?: string;
  connectionSubject?: string;
}

export interface ApprovalConfig {
  fastWaitMs: number;
  lifetimeMs: number;
  lifetimeByRiskMs: Partial<Record<RiskTier, number>>;
}

export type ResumeRevalidator = (
  ticket: FrozenOperationTicket,
) => Promise<{ ok: true } | { ok: false; reason: string; code?: AevraErrorCode }>;

export type ApprovedHandler = (ticket: FrozenOperationTicket) => void;

export type SessionIdentityResolver = (
  sessionId: string,
) => { actor: string; subject: string; connectionId?: string } | null;
