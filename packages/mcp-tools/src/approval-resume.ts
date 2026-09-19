import type { FrozenOperationTicket } from '../../../apps/core/src/approvals/approval-service.js';
import { AevraToolError } from './errors.js';
import { repoState } from './git-state.js';
import {
  authorizationContext,
  isTicketAuthorizedForSession,
  oneTimeAllowed,
  oneTimeKey,
  requiredLease,
  sameConnection,
  verifyTicketAuthority,
  workspaceResult,
  workspaceRoot,
} from './service-helpers.js';
import type { McpRuntimeContext } from './service-types.js';

export async function resumeApproval(
  context: McpRuntimeContext,
  sessionId: string,
  requestId: string,
) {
  if (!context.approvals) return null;
  const ticket = context.approvals.status(requestId);
  if (!ticket) return null;
  if (ticket.state !== 'APPROVED') {
    return isTicketAuthorizedForSession(context, sessionId, ticket) ? ticket : null;
  }
  if (ticket.operation.family === 'workspace:select') {
    return resumeWorkspaceAdmission(context, sessionId, requestId);
  }
  if ((ticket.payload as any)?.tool === 'capability_request') {
    return resumeCapabilityRequest(context, sessionId, requestId);
  }
  return resumeGeneralApproval(context, sessionId, requestId);
}

async function resumeGeneralApproval(
  context: McpRuntimeContext,
  sessionId: string,
  requestId: string,
) {
  return context.approvals!.resume(
    requestId,
    async (current) => {
      const auth = verifyTicketAuthority(context, sessionId, current);
      if (!auth.ok) return auth;
      if (current.expectedState?.head) {
        const lease =
          context.sessions.leaseForWorkspace?.(sessionId, current.workspaceId) ??
          context.sessions.activeLease(sessionId);
        const state = await repoState(
          context,
          sessionId,
          lease!.workspaceId,
          context.workspaces.capabilityRoots(lease!.workspaceId),
        );
        if (state.head !== current.expectedState.head) {
          return { ok: false, reason: 'repository state changed' };
        }
      }
      return { ok: true };
    },
    async (current) => executeFrozen(context, sessionId, current),
    (current) => verifyTicketAuthority(context, sessionId, current),
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
        if (ticket.decisionScope === 'connection') {
          if (!sameConnection(context, sessionId, ticket)) {
            return { ok: false, reason: 'OAuth connection changed' };
          }
        } else if (session.id !== ticket.sessionId || session.actor !== ticket.actor) {
          return { ok: false, reason: 'session changed' };
        }
      } else if (session.id !== ticket.sessionId || session.actor !== ticket.actor) {
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
      } else if (session.id !== ticket.sessionId || session.actor !== ticket.actor) {
        return { ok: false, reason: 'session changed' };
      }
      if (!context.workspaces.getLocal(ticket.workspaceId)) {
        return { ok: false, reason: 'workspace no longer exists' };
      }
      const lease =
        context.sessions.leaseForWorkspace?.(sessionId, ticket.workspaceId) ??
        (context.sessions.activeLease(sessionId)?.workspaceId === ticket.workspaceId
          ? context.sessions.activeLease(sessionId)
          : null);
      if (!lease || lease.workspaceId !== ticket.workspaceId) {
        return { ok: false, reason: 'workspace changed' };
      }
      return { ok: true };
    },
    async (ticket) => {
      const payload = ticket.payload as any;
      const original = payload?.original;
      if (!original?.tool) {
        throw new AevraToolError('INVALID_REQUEST', 'Capability approval has no frozen operation');
      }
      const key = oneTimeKey(
        sessionId,
        ticket.operation.capability,
        String(payload.permissionMatcher ?? '*'),
      );
      const once = ticket.decisionScope === 'once';
      if (once) context.oneTimeCapabilities.add(key);
      try {
        if (original.proxy && context.proxyOperation)
          return await context.proxyOperation(sessionId, original.proxy);
        return await context.callInner(sessionId, String(original.tool), original.args ?? {});
      } finally {
        if (once) context.oneTimeCapabilities.delete(key);
      }
    },
    (ticket) => {
      const lease =
        context.sessions.leaseForWorkspace?.(sessionId, ticket.workspaceId) ??
        (context.sessions.activeLease(sessionId)?.workspaceId === ticket.workspaceId
          ? context.sessions.activeLease(sessionId)
          : null);
      if (!lease || lease.workspaceId !== ticket.workspaceId) {
        return { ok: false, reason: 'workspace changed' };
      }
      return { ok: true };
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
    throw new AevraToolError('INVALID_REQUEST', 'Frozen approval payload is missing');
  }

  if (payload.tool === 'workspace_select') {
    const workspace = context.workspaces.getLocal(
      String(payload.workspaceId ?? ticket.workspaceId),
    );
    if (!workspace) {
      throw new AevraToolError('NOT_FOUND', 'Workspace not found');
    }
    const manifest = context.deps.manifests?.summarize(workspace.hostRoot ?? null);
    const session = context.sessions.get(sessionId)!;
    const profileId = String(
      payload.profileId ?? (session.actor.startsWith('oauth:') ? 'read-only' : 'developer'),
    );
    if (session.actor.startsWith('oauth:') && ticket.decisionScope === 'connection') {
      const lease = context.sessions.grantConnectionWorkspace(sessionId, workspace.id, profileId);
      if (!lease) {
        throw new AevraToolError(
          'APPROVAL_CONTEXT_CHANGED',
          'Workspace grant could not be restored',
        );
      }
      return workspaceResult(workspace, lease.capabilities, manifest);
    }

    const result = await context.sessions.switchWorkspace(
      sessionId,
      workspace.id,
      profileId,
      Math.max(0, Number(payload.drainTimeoutMs ?? 60_000) || 0),
    );
    if (result.status !== 'admitted') {
      throw new AevraToolError(
        'APPROVAL_PENDING',
        'Workspace admission still requires local approval',
      );
    }
    return workspaceResult(workspace, result.lease.capabilities, manifest);
  }

  if (payload.tool === 'command_run') {
    return context.deps.operations!.runCommand(
      sessionId,
      payload.args.command,
      payload.args.executionMode,
      payload.args.networkPolicy,
    );
  }

  const ctx = ticket.workspaceId ? { ...context, workspaceId: ticket.workspaceId } : context;

  if (payload.tool === 'git_commit' || payload.tool === 'git_push') {
    const lease =
      context.sessions.leaseForWorkspace?.(sessionId, ticket.workspaceId) ??
      requiredLease(context, sessionId);
    const cap = payload.tool === 'git_commit' ? 'git.commit' : 'git.push';
    if (!lease.capabilities.includes(cap) && !oneTimeAllowed(context, sessionId, cap, 'git')) {
      throw new AevraToolError('CAPABILITY_REQUIRED', `Workspace lease does not grant ${cap}`);
    }
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
      throw new AevraToolError(result.error.code, result.error.message, result.error.details);
    }
    return result.value;
  }

  if (payload.tool === 'file_delete') {
    const authorization = authorizationContext(ctx, sessionId, 'files.delete', 'files:delete');
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

  if (payload.tool === 'skill_write') {
    const source = payload.args.source === 'workspace' ? 'workspace' : 'user';
    return context.deps.skills!.write(
      source,
      String(payload.args.name ?? ''),
      workspaceRoot(ctx, sessionId),
      payload.args.file ? String(payload.args.file) : undefined,
      String(payload.args.content ?? ''),
    );
  }

  if (payload.tool === 'instructions_write') {
    const source = payload.args.source === 'workspace' ? 'workspace' : 'user';
    return context.deps.skills!.writeInstructions(
      source,
      workspaceRoot(ctx, sessionId),
      String(payload.args.content ?? ''),
    );
  }

  throw new AevraToolError('INVALID_REQUEST', 'Unsupported frozen operation');
}
