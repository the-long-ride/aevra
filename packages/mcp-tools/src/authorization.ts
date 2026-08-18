import type {
  Capability,
  NormalizedOperation,
  RiskTier,
} from '../../protocol/src/index.js';
import { needsCommandPermissionApproval } from '../../../apps/core/src/policy/command-matcher.js';
import { resumeApproval } from './approval-resume.js';
import { AevraToolError } from './errors.js';
import {
  argsHash,
  authorizationContext,
  oneTimeAllowed,
  requiredLease,
  workspaceResult,
} from './service-helpers.js';
import type { McpRuntimeContext } from './service-types.js';

export type CapabilityGate =
  | { authorization: ReturnType<typeof authorizationContext> }
  | { response: any };

export async function workspaceSelect(
  context: McpRuntimeContext,
  sessionId: string,
  args: any,
) {
  const workspace = context.workspaces.getLocal(
    String(args.workspace ?? args.name ?? args.id ?? ''),
  );
  if (!workspace) throw new AevraToolError('NOT_FOUND', 'Workspace not found');

  const session = context.sessions.get(sessionId)!;
  const active = context.sessions.activeLease(sessionId);
  if (active?.workspaceId === workspace.id) {
    return workspaceResult(workspace, active.capabilities);
  }

  const bindings = session.actor.startsWith('connector:')
    ? (context.deps.connectorBindings?.(session.subject) ?? null)
    : null;
  if (bindings?.workspaceId && bindings.workspaceId !== workspace.id) {
    throw new AevraToolError(
      'CAPABILITY_REQUIRED',
      'Connector is bound to a different workspace',
    );
  }

  const override = bindings?.profileCap ?? undefined;
  const drainTimeoutMs = Math.max(
    0,
    Number(args.drainTimeoutMs ?? 60_000) || 0,
  );
  const admission = await context.sessions.switchWorkspace(
    sessionId,
    workspace.id,
    override,
    drainTimeoutMs,
  );
  if (admission.status === 'admitted') {
    return workspaceResult(workspace, admission.lease.capabilities);
  }
  if (!context.approvals) {
    throw new AevraToolError(
      'APPROVAL_PENDING',
      'Local approval service unavailable',
    );
  }

  const profileId = session.actor.startsWith('oauth:')
    ? 'read-only'
    : 'developer';
  const request = await context.approvals.request({
    actor: session.actor,
    sessionId,
    workspaceId: workspace.id,
    operation: {
      family: 'workspace:select',
      capability: 'files.read',
      risk: 'MEDIUM',
      argsHash: argsHash({ workspaceId: workspace.id, profileId }),
    },
    payload: {
      tool: 'workspace_select',
      workspaceId: workspace.id,
      profileId,
      drainTimeoutMs,
    },
    expectedState: { workspaceId: workspace.id },
    risk: 'MEDIUM',
  });
  if (request.status === 'approved') {
    return resumeApproval(context, sessionId, request.requestId);
  }
  return {
    ...request,
    workspace: {
      id: workspace.id,
      name: workspace.name,
      description: workspace.description,
    },
  };
}

export async function authorizeCapability(
  context: McpRuntimeContext,
  sessionId: string,
  capability: Capability,
  original: { tool: string; args: any },
  permissionMatcher: string,
  risk: RiskTier,
): Promise<CapabilityGate> {
  const lease = requiredLease(context, sessionId);
  const session = context.sessions.get(sessionId)!;
  const lowDecision = context.deps.permissions?.decide({
    capability,
    matcher: permissionMatcher,
    workspaceId: lease.workspaceId,
    actor: session.actor,
    sessionId,
    risk: 'LOW',
  });
  if (lowDecision?.outcome === 'deny') {
    throw new AevraToolError('CAPABILITY_REQUIRED', lowDecision.reason);
  }

  const authorization = authorizationContext(
    context,
    sessionId,
    capability,
    permissionMatcher,
  );
  if (
    lease.capabilities.includes(capability) ||
    oneTimeAllowed(context, sessionId, capability, permissionMatcher) ||
    lowDecision?.outcome === 'allow'
  ) {
    return { authorization };
  }
  if (!context.approvals) {
    throw new AevraToolError(
      'APPROVAL_PENDING',
      'Local approval service unavailable',
    );
  }

  const family =
    permissionMatcher === '*' ? `capability:${capability}` : permissionMatcher;
  const request = await context.approvals.request({
    actor: session.actor,
    sessionId,
    workspaceId: lease.workspaceId,
    operation: {
      family,
      capability,
      risk,
      argsHash: argsHash({
        workspaceId: lease.workspaceId,
        capability,
        permissionMatcher,
        original,
      }),
    },
    payload: {
      tool: 'capability_request',
      requestedCapability: capability,
      permissionMatcher,
      original,
    },
    expectedState: { workspaceId: lease.workspaceId },
    risk,
  });
  if (request.status === 'approved') {
    return {
      response: await resumeApproval(context, sessionId, request.requestId),
    };
  }
  return {
    response: {
      ...request,
      requiredCapability: capability,
      permissionMatcher,
    },
  };
}

export async function gated<T>(
  context: McpRuntimeContext,
  sessionId: string,
  normalized: NormalizedOperation,
  payload: unknown,
  expectedState: Record<string, string>,
  execute: () => Promise<T>,
) {
  const session = context.sessions.get(sessionId)!;
  const lease = requiredLease(context, sessionId);
  const forceCriticalApproval =
    normalized.risk === 'CRITICAL' &&
    context.deps.settings?.get<boolean>(
      'policy.critical.alwaysConfirm',
      false,
    ) === true;
  const once = oneTimeAllowed(
    context,
    sessionId,
    normalized.capability,
    normalized.family,
  );
  const decision = context.deps.permissions?.decide({
    capability: normalized.capability,
    matcher: normalized.family,
    workspaceId: lease.workspaceId,
    actor: session.actor,
    sessionId,
    risk: normalized.risk,
  });
  if (decision?.outcome === 'deny') {
    throw new AevraToolError('CAPABILITY_REQUIRED', decision.reason);
  }

  const newCommandApproval =
    normalized.capability === 'commands.run' &&
    needsCommandPermissionApproval(decision?.outcome, once);
  if (once) return execute();
  if (
    normalized.risk === 'LOW' &&
    !forceCriticalApproval &&
    !newCommandApproval
  ) {
    return execute();
  }
  if (
    !forceCriticalApproval &&
    !newCommandApproval &&
    decision?.outcome === 'allow'
  ) {
    return execute();
  }
  if (!context.approvals) {
    throw new AevraToolError(
      'APPROVAL_PENDING',
      'Local approval service unavailable',
    );
  }

  const request = await context.approvals.request({
    actor: session.actor,
    sessionId,
    workspaceId: lease.workspaceId,
    operation: normalized,
    payload,
    expectedState,
    risk: normalized.risk,
  });
  if (request.status === 'approval_pending') return request;
  return resumeApproval(context, sessionId, request.requestId);
}
