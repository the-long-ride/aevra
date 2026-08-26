import type { Capability } from '../../../../packages/protocol/src/index.js';

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
