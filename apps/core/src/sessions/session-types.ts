import type { Capability } from '../../../../packages/protocol/src/index.js';
import type { FrozenOperationTicket } from '../approvals/approval-types.js';

export interface SecuritySession {
  id: string;
  actor: string;
  subject: string;
  connectionId?: string;
  createdAt: string;
  lastActivityAt: string;
  remoteIp?: string;
  activeLeaseId?: string;
}

export interface WorkspaceLease {
  id: string;
  sessionId: string;
  workspaceId: string;
  actor: string;
  capabilities: Capability[];
  expiresAt: string;
}

export type SessionResolution = {
  session: SecuritySession;
  mode: 'created' | 'existing' | 'resumed';
};

export interface DisconnectedIdentity {
  actor: string;
  subject: string;
  connectionId?: string;
  disconnectedAt?: string;
}

export type ConnectionTicketLike = Pick<
  FrozenOperationTicket,
  'actor' | 'connectionId' | 'connectionSubject' | 'sessionId'
>;
