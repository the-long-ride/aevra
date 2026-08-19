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

export function workspaceRoot(context: McpRuntimeContext, sessionId: string): string | null {
  const lease = context.sessions.activeLease(sessionId);
  if (!lease) return null;
  return context.workspaces.getLocal(lease.workspaceId)?.hostRoot ?? null;
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
  const lease = context.sessions.activeLease(sessionId);
  if (!lease) {
    throw new AevraToolError('SESSION_WORKSPACE_REQUIRED', 'Select a workspace first');
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
