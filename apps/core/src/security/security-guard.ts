import type { Capability } from '../../../../packages/protocol/src/index.js';
import {
  classifySensitivity,
  type Sensitivity,
} from '../../../../packages/security/src/sensitive.js';
import type { ManifestPattern } from '../workspaces/manifest-service.js';

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

interface SecuritySessionReader {
  get(sessionId: string): { actor: string; subject: string } | null;
  activeLease(sessionId: string): { workspaceId: string } | null;
}

interface SecurityWorkspaceReader {
  getLocal(workspaceId: string): unknown | null;
}

export interface ManifestPatternSource {
  patternsFor(workspaceId: string): ManifestPattern[];
}

// classifySensitivity returns on the FIRST userPatterns match, so a SECRET
// pattern must be tried before a SENSITIVE one or a path matching both is
// silently downgraded to readable. Sorting here — rather than only
// documenting the requirement on ManifestPatternSource implementers — makes
// this guarantee hold regardless of what order any collaborator returns
// patterns in; a security invariant should not depend on every caller
// remembering a convention.
function secretsFirst(patterns: ManifestPattern[]): ManifestPattern[] {
  return [...patterns].sort((a, b) => (a.class === b.class ? 0 : a.class === 'SECRET' ? -1 : 1));
}

export class SecurityGuard {
  constructor(
    private sessions: SecuritySessionReader,
    private workspaces: SecurityWorkspaceReader,
    private manifests?: ManifestPatternSource,
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

    const sensitivity = classifySensitivity({
      path: input.logicalPath,
      userPatterns: secretsFirst(this.manifests?.patternsFor(lease.workspaceId) ?? []),
    });
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
