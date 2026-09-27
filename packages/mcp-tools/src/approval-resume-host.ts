import type { FrozenOperationTicket } from '../../../apps/core/src/approvals/approval-service.js';
import { AevraToolError } from './errors.js';
import { argsHash } from './service-helpers.js';
import type { McpRuntimeContext } from './service-types.js';

export function resumeHostApproval(
  context: McpRuntimeContext,
  sessionId: string,
  requestId: string,
  ticket: FrozenOperationTicket,
) {
  if (!context.deps.hostControlApproval?.canResume(sessionId, requestId)) return null;
  if (ticket.state !== 'APPROVED') return ticket;
  const capability = ticket.operation.capability as 'browser.control' | 'desktop.control';
  if (!context.deps.hostControlAccess?.has(sessionId, capability)) {
    throw new AevraToolError('APPROVAL_CONTEXT_CHANGED', 'Host control grant is no longer active');
  }
  if (ticket.operation.family === 'host-control:request') return { status: 'approved', capability };
  return context.approvals!.resume(
    requestId,
    async (current) => {
      if (!context.deps.hostControlAccess?.has(sessionId, capability))
        return { ok: false, reason: 'host control grant revoked' };
      if (capability !== 'browser.control') return { ok: true };
      const binding = (current.payload as any)?.browserBinding;
      if (!binding?.tabId) return { ok: false, reason: 'browser target binding is unavailable' };
      const identity = context.deps.hostControlAccess.identity(sessionId);
      if (!identity) return { ok: false, reason: 'browser connection identity changed' };
      const status = await context.worker.execute({
        sessionId,
        workspaceId: '',
        scope: { kind: 'host-control', capability, identity },
        roots: [],
        operation: { kind: 'browser.status' },
        executionMode: 'host',
      });
      if (!status.ok) return { ok: false, reason: 'browser attachment is unavailable' };
      const live = status.value as any;
      if (!live.connected || !live.attachmentId)
        return { ok: false, reason: 'browser attachment is unavailable' };
      const actual = {
        attachmentId: live.attachmentId ?? null,
        transport: live.transport ?? null,
        pairingId: live.activePairingId ?? null,
        profileId: live.activeProfileId ?? null,
        tabId: binding.tabId,
        url: live.tabs?.find((tab: any) => tab.tabId === binding.tabId)?.url ?? null,
      };
      return argsHash(actual) === argsHash(binding)
        ? { ok: true }
        : { ok: false, reason: 'browser attachment or approved tab changed' };
    },
    async (current) => {
      const payload = current.payload as { tool?: string; args?: unknown } | undefined;
      if (!payload?.tool)
        throw new AevraToolError('INVALID_REQUEST', 'Host action approval has no frozen tool');
      if ((payload as { requiresVolatileArgs?: boolean }).requiresVolatileArgs)
        throw new AevraToolError(
          'APPROVAL_CONTEXT_CHANGED',
          'The approved desktop content is no longer available in memory',
        );
      const proof = {
        requestId,
        sessionId,
        capability,
        family: current.operation.family,
        risk: current.operation.risk,
        payloadHash: current.operation.argsHash,
        consumed: false,
      };
      return context.callInner(sessionId, payload.tool, payload.args ?? {}, proof);
    },
    () =>
      context.deps.hostControlAccess?.has(sessionId, capability)
        ? { ok: true }
        : { ok: false, reason: 'host control grant revoked' },
  );
}
