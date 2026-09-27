import type { HostControlCapability } from '../../store/src/host-control-grants.js';
import type { RiskTier, NormalizedOperation } from '../../protocol/src/index.js';
import { AevraToolError } from './errors.js';
import { argsHash } from './service-helpers.js';
import type { McpRuntimeContext } from './service-types.js';
import { resumeApproval } from './approval-resume.js';
import { yoloAllows } from './yolo-mode.js';

export function requireHostControl(
  context: McpRuntimeContext,
  sessionId: string,
  capability: HostControlCapability,
) {
  if (!context.deps.hostControlAccess?.has(sessionId, capability)) {
    throw new AevraToolError('CAPABILITY_REQUIRED', `Host ${capability} grant is no longer active`);
  }
}

export function requireHostControlIdentity(
  context: McpRuntimeContext,
  sessionId: string,
  capability: HostControlCapability,
) {
  requireHostControl(context, sessionId, capability);
  const identity = context.deps.hostControlAccess?.identity(sessionId);
  if (!identity) throw new AevraToolError('UNAUTHORIZED', 'Unknown Aevra connection');
  return identity;
}

export async function authorizeHostControl(
  context: McpRuntimeContext,
  sessionId: string,
  capability: HostControlCapability,
  tool: string,
  args: unknown,
  matcher: string,
  risk: RiskTier,
): Promise<{ response: unknown } | { granted: true }> {
  const session = context.sessions.get(sessionId);
  if (!session) throw new AevraToolError('UNAUTHORIZED', 'Unknown Aevra session');
  if (!context.deps.hostControlAccess?.has(sessionId, capability)) {
    if (!context.deps.hostControlApproval)
      throw new AevraToolError('APPROVAL_PENDING', 'Local host control approval is unavailable');
    const request = await context.deps.hostControlApproval.requestHostControl(
      sessionId,
      capability,
      { tool, args },
    );
    return { response: { ...request, requiredCapability: capability, scope: 'host-control' } };
  }
  const decision = context.deps.permissions?.decide?.({
    capability,
    matcher,
    actor: session.actor,
    sessionId,
    risk,
  });
  if (decision?.outcome === 'deny')
    throw new AevraToolError('CAPABILITY_REQUIRED', decision.reason);
  return { granted: true };
}

export async function gatedHostControl<T>(
  context: McpRuntimeContext,
  sessionId: string,
  normalized: NormalizedOperation,
  payload: {
    tool: string;
    args: unknown;
    requiresVolatileArgs?: boolean;
    browserBinding?: unknown;
  },
  execute: () => Promise<T>,
  volatilePayload?: { tool: string; args: unknown },
) {
  const capability = normalized.capability as HostControlCapability;
  requireHostControl(context, sessionId, capability);
  const session = context.sessions.get(sessionId)!;
  const decision = context.deps.permissions?.decide?.({
    capability,
    matcher: normalized.family,
    actor: session.actor,
    sessionId,
    risk: normalized.risk,
  });
  if (decision?.outcome === 'deny')
    throw new AevraToolError('CAPABILITY_REQUIRED', decision.reason);
  const identity = context.deps.hostControlAccess?.identity(sessionId);
  if (!identity) throw new AevraToolError('UNAUTHORIZED', 'Unknown Aevra connection');
  const proof = context.hostApprovalProof;
  const approvedInvocation = Boolean(
    proof &&
    !proof.consumed &&
    proof.sessionId === sessionId &&
    proof.capability === capability &&
    proof.family === normalized.family &&
    proof.risk === normalized.risk &&
    proof.payloadHash === argsHash({ identity, payload }) &&
    context.approvals?.status(proof.requestId)?.state === 'EXECUTING',
  );
  if (proof && !approvedInvocation) {
    throw new AevraToolError('APPROVAL_CONTEXT_CHANGED', 'Approved host action context changed');
  }
  if (approvedInvocation) proof!.consumed = true;
  if (
    normalized.risk === 'LOW' ||
    decision?.outcome === 'allow' ||
    approvedInvocation ||
    yoloAllows(context, sessionId, { capability, risk: normalized.risk, family: normalized.family })
  )
    return execute();
  if (!context.approvals)
    throw new AevraToolError('APPROVAL_PENDING', 'Local approval service is unavailable');
  const request = await context.approvals.request(
    {
      actor: session.actor,
      sessionId,
      workspaceId: '',
      scope: 'host',
      identity,
      operation: { ...normalized, argsHash: argsHash({ identity, payload }) },
      payload,
      expectedState: {},
      risk: normalized.risk,
    },
    volatilePayload,
  );
  if (request.status === 'approval_pending') return request;
  return resumeApproval(context, sessionId, request.requestId);
}
