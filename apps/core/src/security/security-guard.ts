import type { Capability } from '../../../../packages/protocol/src/index.js';
import {
  classifySensitivity,
  type Sensitivity,
} from '../../../../packages/security/src/sensitive.js';
import type { SessionManager } from '../sessions/session-manager.js';
import type { WorkspaceService } from '../workspaces/workspace-service.js';

export type ResourceSecurityDecision = 'allow' | 'approval-required' | 'deny';
export type ResourceOperation = 'read' | 'search' | 'write' | 'patch' | 'move' | 'delete';

export interface ResourceAuthorizationInput {
  sessionId: string;
  capability: Capability;
  operation: ResourceOperation;
  logicalPath: string;
  mutation: boolean;
}

export interface ResourceAuthorizationResult {
  workspaceId: string;
  capability: Capability;
  sensitivity: Sensitivity;
  decision: ResourceSecurityDecision;
  approvalScope?: 'once';
}

export class SecurityGuard {
  constructor(
    private sessions: SessionManager,
    private workspaces: WorkspaceService,
  ) {}

  authorizeResource(input: ResourceAuthorizationInput): ResourceAuthorizationResult {
    const session = this.sessions.get(input.sessionId);
    if (!session) throw Object.assign(new Error('Unknown Aevra session'), { code: 'UNAUTHORIZED' });
    const lease = this.sessions.activeLease(input.sessionId);
    if (!lease) {
      throw Object.assign(new Error('Select a workspace first'), {
        code: 'SESSION_WORKSPACE_REQUIRED',
      });
    }
    if (!this.workspaces.getLocal(lease.workspaceId)) {
      throw Object.assign(new Error('Workspace not found'), { code: 'NOT_FOUND' });
    }

    const sensitivity = classifySensitivity({ path: input.logicalPath });
    const base = {
      workspaceId: lease.workspaceId,
      capability: input.capability,
      sensitivity,
    };

    if (sensitivity === 'SECRET') return { ...base, decision: 'deny' };
    if (sensitivity === 'SENSITIVE' && input.mutation) {
      return { ...base, decision: 'approval-required', approvalScope: 'once' };
    }
    return { ...base, decision: 'allow' };
  }
}
