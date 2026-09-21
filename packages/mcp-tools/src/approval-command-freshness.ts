import type { FrozenOperationTicket } from '../../../apps/core/src/approvals/approval-service.js';
import { validateCommandApprovalBinding } from '../../../apps/core/src/approvals/command-binding.js';
import {
  normalizeYoloMode,
  type CommandAnalysis,
  type CommandRequest,
} from '../../protocol/src/index.js';
import { evaluateAndDecideCommand } from './command-decision-bridge.js';
import type { McpRuntimeContext } from './service-types.js';

export async function freshCommandAnalysis(
  context: McpRuntimeContext,
  sessionId: string,
  ticket: FrozenOperationTicket,
  payload: any,
): Promise<{ ok: true; analysis: CommandAnalysis } | { ok: false; reason: string }> {
  const frozenAnalysis = payload?.commandAnalysis as CommandAnalysis | undefined;
  if (!frozenAnalysis) return { ok: false, reason: 'Frozen command analysis is missing' };

  const request = payload.commandRequest as CommandRequest | undefined;
  if (!request) return { ok: false, reason: 'Frozen command request is missing' };

  const session = context.sessions.get(sessionId);
  const lease =
    context.sessions.leaseForWorkspace?.(sessionId, ticket.workspaceId) ??
    context.sessions.activeLease(sessionId);
  if (!session || !lease || lease.workspaceId !== ticket.workspaceId) {
    return { ok: false, reason: 'workspace changed' };
  }

  const permissionMatcher = String(payload.permissionMatcher ?? ticket.operation.family ?? '*');
  const legacyDecision = context.deps.permissions?.decide?.({
    capability: 'commands.run',
    matcher: permissionMatcher,
    workspaceId: lease.workspaceId,
    actor: session.actor,
    sessionId,
    risk: ticket.operation.risk,
  });
  const yoloMode = normalizeYoloMode(
    context.deps.settings?.get<{ mode?: string }>('policy.yolo', { mode: 'workspace' })?.mode,
  );

  const evaluationContext = { ...context, workspaceId: lease.workspaceId } as McpRuntimeContext;
  const { analysis, decision } = await evaluateAndDecideCommand(evaluationContext, sessionId, {
    commandRequest: request,
    permissionMatcher,
    rawDestinations: request.networkDestinations ?? [],
    isYolo: Boolean(context.sessions.isYolo?.(sessionId)),
    yoloMode,
    legacyDecision: legacyDecision?.outcome === 'deny' ? legacyDecision : undefined,
    riskFloor: payload.riskFloor ?? ticket.operation.risk,
  });

  if (decision.outcome === 'deny') {
    return { ok: false, reason: 'permission policy changed' };
  }
  if (decision.outcome === 'invalid') {
    return { ok: false, reason: 'command analysis is no longer valid' };
  }
  if (
    decision.outcome === 'approval' &&
    !payload.networkApproval &&
    decision.reasons.some(
      (reason) =>
        reason.code === 'NETWORK_DESTINATION_REQUIRED' || reason.code === 'NETWORK_REQUIRED',
    )
  ) {
    return { ok: false, reason: 'network policy changed' };
  }

  const binding = validateCommandApprovalBinding(ticket.id, analysis);
  if (!binding.ok) return binding;
  return { ok: true, analysis };
}
