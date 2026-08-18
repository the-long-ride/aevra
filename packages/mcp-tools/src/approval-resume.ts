import type { FrozenOperationTicket } from '../../../apps/core/src/approvals/approval-service.js';
import { AevraToolError } from './errors.js';
import { repoState } from './git-state.js';
import {
  authorizationContext,
  oneTimeAllowed,
  oneTimeKey,
  requiredLease,
  workspaceResult,
} from './service-helpers.js';
import type { McpRuntimeContext } from './service-types.js';

function sameConnection(
  context: McpRuntimeContext,
  currentSessionId: string,
  ticket: FrozenOperationTicket,
): boolean {
  const current = context.sessions.connectionIdentity(currentSessionId);
  const original = context.sessions.connectionIdentity(ticket.sessionId);
  return Boolean(
    current &&
      original &&
      current.actor === ticket.actor &&
      current.actor === original.actor &&
      current.subject === original.subject,
  );
}

export async function resumeApproval(
  context: McpRuntimeContext,
  sessionId: string,
  requestId: string,
) {
  if (!context.approvals) return null;
  const ticket = context.approvals.status(requestId);
  if (!ticket) return null;
  if (ticket.state !== 'APPROVED') return ticket;
  if (ticket.operation.family === 'workspace:select') {
    return resumeWorkspaceAdmission(context, sessionId, requestId);
  }
  if ((ticket.payload as any)?.tool === 'capability_request') {
    return resumeCapabilityRequest(context, sessionId, requestId);
  }

  return context.approvals.resume(
    requestId,
    async (current) => {
      const session = context.sessions.get(sessionId);
      const lease = context.sessions.activeLease(sessionId);
      if (
        !session ||
        session.id !== current.sessionId ||
        session.actor !== current.actor
      ) {
        return { ok: false, reason: 'session changed' };
      }
      if (!lease || lease.workspaceId !== current.workspaceId) {
        return { ok: false, reason: 'workspace changed' };
      }

      const currentPermission = context.deps.permissions?.decide({
        capability: current.operation.capability,
        matcher: current.operation.family,
        workspaceId: lease.workspaceId,
        actor: session.actor,
        sessionId,
        risk: 'LOW',
      });
      if (currentPermission?.outcome === 'deny') {
        return { ok: false, reason: 'permission policy changed' };
      }
      if (
        !lease.capabilities.includes(current.operation.capability) &&
        currentPermission?.outcome !== 'allow' &&
        !oneTimeAllowed(
          context,
          sessionId,
          current.operation.capability,
          current.operation.family,
        )
      ) {
        return { ok: false, reason: 'capability changed' };
      }

      if (current.expectedState?.head) {
        const state = await repoState(
          context,
          sessionId,
          lease.workspaceId,
          context.workspaces.capabilityRoots(lease.workspaceId),
        );
        if (state.head !== current.expectedState.head) {
          return { ok: false, reason: 'repository state changed' };
        }
      }
      return { ok: true };
    },
    async (current) => executeFrozen(context, sessionId, current),
  );
}

async function resumeWorkspaceAdmission(
  context: McpRuntimeContext,
  sessionId: string,
  requestId: string,
) {
  return context.approvals!.resume(
    requestId,
    async (ticket) => {
      const session = context.sessions.get(sessionId);
      if (!session) return { ok: false, reason: 'session changed' };
      if (ticket.actor.startsWith('oauth:')) {
        if (!sameConnection(context, sessionId, ticket)) {
          return { ok: false, reason: 'OAuth connection changed' };
        }
      } else if (
        session.id !== ticket.sessionId ||
        session.actor !== ticket.actor
      ) {
        return { ok: false, reason: 'session changed' };
      }
      if (!context.workspaces.getLocal(ticket.workspaceId)) {
        return { ok: false, reason: 'workspace no longer exists' };
      }
      return { ok: true };
    },
    async (ticket) => executeFrozen(context, sessionId, ticket),
  );
}

async function resumeCapabilityRequest(
  context: McpRuntimeContext,
  sessionId: string,
  requestId: string,
) {
  return context.approvals!.resume(
    requestId,
    async (ticket) => {
      const session = context.sessions.get(sessionId);
      if (!session) return { ok: false, reason: 'session changed' };
      if (ticket.actor.startsWith('oauth:')) {
        if (!sameConnection(context, sessionId, ticket)) {
          return { ok: false, reason: 'OAuth connection changed' };
        }
      } else if (
        session.id !== ticket.sessionId ||
        session.actor !== ticket.actor
      ) {
        return { ok: false, reason: 'session changed' };
      }
      if (!context.workspaces.getLocal(ticket.workspaceId)) {
        return { ok: false, reason: 'workspace no longer exists' };
      }
      const lease = context.sessions.activeLease(sessionId);
      if (!lease || lease.workspaceId !== ticket.workspaceId) {
        return { ok: false, reason: 'workspace changed' };
      }
      return { ok: true };
    },
    async (ticket) => {
      const payload = ticket.payload as any;
      const original = payload?.original;
      if (!original?.tool) {
        throw new AevraToolError(
          'INVALID_REQUEST',
          'Capability approval has no frozen operation',
        );
      }
      const key = oneTimeKey(
        sessionId,
        ticket.operation.capability,
        String(payload.permissionMatcher ?? '*'),
      );
      const once = ticket.decisionScope === 'once';
      if (once) context.oneTimeCapabilities.add(key);
      try {
        return await context.callInner(
          sessionId,
          String(original.tool),
          original.args ?? {},
        );
      } finally {
        if (once) context.oneTimeCapabilities.delete(key);
      }
    },
  );
}

async function executeFrozen(
  context: McpRuntimeContext,
  sessionId: string,
  ticket: FrozenOperationTicket,
) {
  const payload = ticket.payload as any;
  if (!payload?.tool) {
    throw new AevraToolError(
      'INVALID_REQUEST',
      'Frozen approval payload is missing',
    );
  }

  if (payload.tool === 'workspace_select') {
    const workspace = context.workspaces.getLocal(
      String(payload.workspaceId ?? ticket.workspaceId),
    );
    if (!workspace) {
      throw new AevraToolError('NOT_FOUND', 'Workspace not found');
    }
    const session = context.sessions.get(sessionId)!;
    if (session.actor.startsWith('oauth:')) {
      const lease =
        context.sessions.grantConnectionWorkspace(
          sessionId,
          workspace.id,
          'read-only',
        ) ?? context.sessions.activeLease(sessionId);
      if (!lease) {
        throw new AevraToolError(
          'APPROVAL_CONTEXT_CHANGED',
          'Workspace grant could not be restored',
        );
      }
      return workspaceResult(workspace, lease.capabilities);
    }

    const result = await context.sessions.switchWorkspace(
      sessionId,
      workspace.id,
      String(payload.profileId ?? 'developer'),
      Math.max(0, Number(payload.drainTimeoutMs ?? 60_000) || 0),
    );
    if (result.status !== 'admitted') {
      throw new AevraToolError(
        'APPROVAL_PENDING',
        'Workspace admission still requires local approval',
      );
    }
    return workspaceResult(workspace, result.lease.capabilities);
  }

  if (payload.tool === 'command_run') {
    return context.deps.operations!.runCommand(
      sessionId,
      payload.args.command,
      payload.args.executionMode,
      payload.args.networkPolicy,
    );
  }

  if (payload.tool === 'git_commit' || payload.tool === 'git_push') {
    const lease = requiredLease(context, sessionId);
    const roots = context.workspaces.capabilityRoots(lease.workspaceId);
    const operation: any =
      payload.tool === 'git_commit'
        ? {
            kind: 'git.commit',
            message: String(payload.args.message),
            args: payload.args.args ?? [],
          }
        : {
            kind: 'git.push',
            remote: payload.args.remote,
            branch: payload.args.branch,
            args: payload.args.args ?? [],
          };
    const result = await context.worker.execute({
      sessionId,
      workspaceId: lease.workspaceId,
      roots,
      operation,
      executionMode: 'host',
    });
    if (!result.ok) {
      throw new AevraToolError(
        result.error.code,
        result.error.message,
        result.error.details,
      );
    }
    return result.value;
  }

  if (payload.tool === 'file_delete') {
    const authorization = authorizationContext(
      context,
      sessionId,
      'files.delete',
      'files:delete',
    );
    return context.deps.operations!.delete(
      sessionId,
      {
        path: String(payload.args.path),
        recursive: Boolean(payload.args.recursive),
      },
      authorization,
    );
  }

  if (payload.tool === 'change_rollback') {
    return context.deps.changes!.rollback(String(payload.args.changeSetId), {
      force: false,
      skipPaths: [],
    });
  }

  if (payload.tool === 'process_start') {
    return context.processStart(sessionId, payload.args);
  }

  throw new AevraToolError(
    'INVALID_REQUEST',
    'Unsupported frozen operation',
  );
}
