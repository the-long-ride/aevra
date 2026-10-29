import type { Capability } from '../../protocol/src/index.js';
import { resumeApproval } from './approval-resume.js';
import { AevraToolError } from './errors.js';
import { argsHash, oneTimeAllowed, requiredLease } from './service-helpers.js';
import type { McpRuntimeContext } from './service-types.js';
import type { TransferEntrySummary } from './transfer-entries.js';
import { yoloDoesWhatever } from './yolo-mode.js';

const TRANSFER_FAMILY = 'files:transfer';

export interface TransferApprovalInput {
  direction: 'download' | 'upload';
  tool: 'files_download' | 'files_upload';
  capability: Capability;
  /** The full frozen call; held only in the volatile approval slot (R3). */
  args: Record<string, unknown>;
  /** The same call reduced to the summaries; the only form that is persisted. */
  storedArgs: Record<string, unknown>;
  entries: TransferEntrySummary[];
  headersSupplied: number;
}

/** R1: transfers always ask, except under a YOLO session that chose `do-whatever`. */
export function transferNeedsApproval(context: McpRuntimeContext, sessionId: string): boolean {
  return !yoloDoesWhatever(context, sessionId);
}

/** True while an approved once-scoped transfer ticket is being replayed. */
export function transferApproved(
  context: McpRuntimeContext,
  sessionId: string,
  capability: Capability,
): boolean {
  return oneTimeAllowed(context, sessionId, capability, '*');
}

/** A remembered DENY on the capability wins over every YOLO setting. */
export function assertTransferPermitted(
  context: McpRuntimeContext,
  sessionId: string,
  capability: Capability,
): void {
  const lease = requiredLease(context, sessionId);
  const session = context.sessions.get(sessionId)!;
  const decision = context.deps.permissions?.decide?.({
    capability,
    matcher: '*',
    workspaceId: lease.workspaceId,
    actor: session.actor,
    sessionId,
    risk: 'LOW',
  });
  if (decision?.outcome === 'deny')
    throw new AevraToolError('CAPABILITY_REQUIRED', decision.reason);
}

/**
 * One HIGH, once-scoped approval for the whole batch. The ticket stores only the
 * summaries; the real call (bytes, headers, full URLs) lives in the approval
 * service's in-memory slot and dies with the ticket. Approval replays the call
 * with a proof bound to the exact frozen arguments.
 */
export async function requestTransferApproval(
  context: McpRuntimeContext,
  sessionId: string,
  input: TransferApprovalInput,
) {
  const lease = requiredLease(context, sessionId);
  const session = context.sessions.get(sessionId)!;
  if (!context.approvals) {
    throw new AevraToolError('APPROVAL_PENDING', 'Local approval service unavailable');
  }
  const frozen = { tool: input.tool, args: input.args };
  const stored = {
    tool: 'capability_request',
    requestedCapability: input.capability,
    permissionMatcher: '*',
    securityOnce: true,
    original: { tool: input.tool, args: input.storedArgs },
    transfer: {
      direction: input.direction,
      entries: input.entries,
      headersSupplied: input.headersSupplied,
    },
  };
  const request = await context.approvals.request(
    {
      actor: session.actor,
      sessionId,
      workspaceId: lease.workspaceId,
      operation: {
        family: TRANSFER_FAMILY,
        capability: input.capability,
        risk: 'HIGH',
        argsHash: argsHash({ workspaceId: lease.workspaceId, family: TRANSFER_FAMILY, frozen }),
      },
      payload: stored,
      expectedState: { workspaceId: lease.workspaceId },
      risk: 'HIGH',
    },
    { ...stored, original: frozen },
  );
  if (request.status === 'approved') return resumeApproval(context, sessionId, request.requestId);
  return {
    ...request,
    requiredCapability: input.capability,
    permissionMatcher: '*',
    securityApprovalScope: 'once',
  };
}
