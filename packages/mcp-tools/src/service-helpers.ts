import { createHash } from 'node:crypto';
import type { Capability, RiskTier } from '../../protocol/src/index.js';
import type { AuthorizedCapabilityContext } from '../../../apps/core/src/operations/operation-service.js';
import { AevraToolError } from './errors.js';
import type { McpRuntimeContext } from './service-types.js';

export function argsHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const riskRank: Record<RiskTier, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

export function maxRisk(left: RiskTier, right: RiskTier): RiskTier {
  return riskRank[left] >= riskRank[right] ? left : right;
}

export function sessionLeases(context: McpRuntimeContext, sessionId: string) {
  const manager = context.sessions as typeof context.sessions & {
    leases?: (id: string) => ReturnType<typeof context.sessions.leases>;
  };
  if (typeof manager.leases === 'function') return manager.leases(sessionId);
  const active = context.sessions.activeLease(sessionId);
  return active ? [active] : [];
}

export function resolveWorkspaceLease(
  context: McpRuntimeContext,
  sessionId: string,
  args: { workspace?: unknown; workspaceId?: unknown } = {},
) {
  const workspaceName = String(args.workspace ?? '').trim();
  const workspaceId = String(args.workspaceId ?? '').trim();
  const byName = workspaceName ? context.workspaces.getLocal(workspaceName) : null;
  const byId = workspaceId ? context.workspaces.getLocal(workspaceId) : null;

  if (workspaceName && !byName) {
    throw new AevraToolError('WORKSPACE_NOT_FOUND', `Workspace not found: ${workspaceName}`);
  }
  if (workspaceId && !byId) {
    throw new AevraToolError('WORKSPACE_NOT_FOUND', `Workspace not found: ${workspaceId}`);
  }
  if (byName && byId && byName.id !== byId.id) {
    throw new AevraToolError(
      'INVALID_WORKSPACE_TARGET',
      'workspace and workspaceId refer to different workspaces',
    );
  }

  const targeted = byName ?? byId;
  if (targeted) {
    const lease = context.sessions.leaseForWorkspace(sessionId, targeted.id);
    if (!lease) {
      throw new AevraToolError(
        'WORKSPACE_ACCESS_REQUIRED',
        `Workspace access requires local approval: ${targeted.name}`,
        { workspace: { id: targeted.id, name: targeted.name } },
      );
    }
    return lease;
  }

  const leases = sessionLeases(context, sessionId);
  if (!leases.length) {
    throw new AevraToolError('SESSION_WORKSPACE_REQUIRED', 'Request workspace access first');
  }
  if (leases.length > 1) {
    const allowed = context.workspaces
      .listRemote()
      .filter((workspace) => leases.some((lease) => lease.workspaceId === workspace.id))
      .map(({ id, name }) => ({ id, name }));
    throw new AevraToolError(
      'WORKSPACE_REQUIRED',
      'Multiple workspaces are granted; specify workspace or workspaceId',
      { workspaces: allowed },
    );
  }
  return leases[0]!;
}

export function workspaceRoot(context: McpRuntimeContext, sessionId: string): string | null {
  if (context.workspaceId) {
    const lease = context.sessions.leaseForWorkspace(sessionId, context.workspaceId);
    if (!lease) return null;
    return context.workspaces.getLocal(lease.workspaceId)?.hostRoot ?? null;
  }
  const leases = sessionLeases(context, sessionId);
  if (!leases.length) return null;
  if (leases.length > 1) {
    throw new AevraToolError(
      'WORKSPACE_REQUIRED',
      'Multiple workspaces are granted; specify workspace or workspaceId',
    );
  }
  return context.workspaces.getLocal(leases[0]!.workspaceId)?.hostRoot ?? null;
}

export function requiredLease(
  context: McpRuntimeContext,
  sessionId: string,
  capability?: Capability,
) {
  if (context.sessions.isSwitching?.(sessionId)) {
    throw new AevraToolError(
      'SESSION_WORKSPACE_REQUIRED',
      'Workspace switch is draining in-flight operations',
    );
  }
  const lease = context.workspaceId
    ? context.sessions.leaseForWorkspace(sessionId, context.workspaceId)
    : context.sessions.activeLease(sessionId);
  if (!lease) {
    if (!context.workspaceId && sessionLeases(context, sessionId).length > 1) {
      throw new AevraToolError(
        'WORKSPACE_REQUIRED',
        'Multiple workspaces are granted; specify workspace or workspaceId',
      );
    }
    throw new AevraToolError('SESSION_WORKSPACE_REQUIRED', 'Request workspace access first');
  }
  if (capability && !lease.capabilities.includes(capability)) {
    throw new AevraToolError('CAPABILITY_REQUIRED', capability);
  }
  return lease;
}

export function workspaceResult(
  workspace: { id: string; name: string; description: string },
  capabilities: Capability[],
) {
  return {
    status: 'selected',
    workspace: {
      id: workspace.id,
      name: workspace.name,
      description: workspace.description,
    },
    capabilities,
  };
}

export function oneTimeKey(sessionId: string, capability: Capability, matcher: string): string {
  return `${sessionId}\u0000${capability}\u0000${matcher}`;
}

export function oneTimeAllowed(
  context: McpRuntimeContext,
  sessionId: string,
  capability: Capability,
  matcher: string,
): boolean {
  return (
    context.oneTimeCapabilities.has(oneTimeKey(sessionId, capability, matcher)) ||
    context.oneTimeCapabilities.has(oneTimeKey(sessionId, capability, '*'))
  );
}

export function authorizationContext(
  context: McpRuntimeContext,
  sessionId: string,
  capability: Capability,
  matcher: string,
): AuthorizedCapabilityContext {
  const session = context.sessions.get(sessionId);
  const lease = requiredLease(context, sessionId);
  if (!session) {
    throw new AevraToolError('UNAUTHORIZED', 'Unknown Aevra session');
  }
  return {
    sessionId,
    workspaceId: lease.workspaceId,
    actor: session.actor,
    capability,
    matcher,
  };
}

export function unavailable(name: string): never {
  throw new AevraToolError('CAPABILITY_REQUIRED', `Tool ${name} is not configured`);
}
