import { randomUUID } from 'node:crypto';
import { buildSuggestedRule } from '../../policy/command-decision.js';
import { validateCommandRuleV2 } from '../../policy/command-rule-validation.js';
import { permissionRuleFromApproval } from '../approval-permissions.js';
import { readAdminBody, sendAdminResponse } from './http.js';
import { criticalPersistentRule } from './route-state.js';
import type { AdminRouteHandler } from './types.js';

function permissionRuleDto(row: any) {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    workspaceId: row.workspaceId ?? row.workspace_id ?? undefined,
    sessionId: row.sessionId ?? row.session_id ?? undefined,
    createdAt: row.createdAt ?? row.created_at ?? undefined,
    lastUsedAt: row.lastUsedAt ?? row.last_used_at ?? undefined,
    expiresAt: row.expiresAt ?? row.expires_at ?? undefined,
    predicate_json: row.predicate_json ?? row.predicateJson,
  };
}

export const handleApprovalPermissionRoutes: AdminRouteHandler = async (req, res, url, context) => {
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (path === '/api/approvals' && method === 'GET') {
    sendAdminResponse(res, 200, context.approvals?.list?.() ?? []);
    return true;
  }

  let match = path.match(/^\/api\/approvals\/([^/]+)\/yolo$/);
  if (match && method === 'POST') {
    const before = context.approvals?.status?.(match[1]);
    if (!before) {
      sendAdminResponse(res, 404, {
        error: { code: 'NOT_FOUND', message: 'Approval request not found' },
      });
      return true;
    }
    if (!['PENDING', 'APPROVED', 'EXPIRED'].includes(before.state)) {
      sendAdminResponse(res, 409, {
        error: { code: 'INVALID_STATE', message: `Cannot enable YOLO for ${before.state} request` },
      });
      return true;
    }
    try {
      const yolo = context.sessions?.enableYolo?.(before.sessionId);
      let ticket = before;
      if (before.state === 'PENDING') {
        try {
          ticket = context.approvals.approve(match[1], 'once');
        } catch (error) {
          context.sessions?.disableYolo?.(before.sessionId);
          throw error;
        }
      }
      context.audit?.append?.({
        actor: 'admin',
        sessionId: before.sessionId,
        workspaceId: before.workspaceId,
        operation: 'session.yolo.enable',
        target: before.actor,
        result: 'ok',
        redactionCount: 0,
        class: 'security',
      });
      sendAdminResponse(res, 200, {
        ok: true,
        revision: Date.now(),
        ticket,
        yolo,
      });
    } catch (error) {
      sendAdminResponse(res, 400, {
        error: {
          code: 'YOLO_NOT_ALLOWED',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
    return true;
  }

  match = path.match(/^\/api\/approvals\/([^/]+)\/(approve|deny)$/);
  if (match && method === 'POST') {
    const input = await readAdminBody(req);
    const before = context.approvals?.status?.(match[1]);
    if (!before) {
      sendAdminResponse(res, 404, {
        error: { code: 'NOT_FOUND', message: 'Approval request not found' },
      });
      return true;
    }
    const admission = before?.operation?.family === 'workspace:select';
    const scope = admission ? 'once' : (input.scope ?? 'once');
    const ticket =
      match[2] === 'approve'
        ? before.state === 'APPROVED'
          ? before
          : context.approvals.approve(match[1], scope)
        : before.state === 'DENIED'
          ? before
          : context.approvals.deny(match[1]);

    if (match[2] === 'approve' && !admission && context.permissions && before.state === 'PENDING') {
      let rule: any = permissionRuleFromApproval(
        ticket,
        scope,
        `perm_${randomUUID()}`,
        new Date().toISOString(),
      );
      const payload = before.payload as any;
      if (ticket.operation.capability === 'commands.run' && payload?.commandAnalysis?.nodes?.[0]) {
        const analysisScope = payload.commandAnalysis.scope;
        if (scope !== 'once' && analysisScope === 'inside') {
          const suggested = buildSuggestedRule(payload.commandAnalysis.nodes[0]);
          rule = {
            id: `perm_${randomUUID()}`,
            effect: 'allow',
            capability: 'commands.run',
            scope: scope === 'workspace' ? 'workspace' : scope === 'session' ? 'session' : 'global',
            ...(scope === 'workspace' ? { workspaceId: before.workspaceId } : {}),
            ...(scope === 'session' ? { sessionId: before.sessionId } : {}),
            actor: before.actor,
            matcher: payload.permissionMatcher ?? '*',
            version: 2,
            status: 'active',
            predicate_json: JSON.stringify(suggested),
            createdAt: new Date().toISOString(),
          };
        } else if (scope !== 'once') {
          rule = null;
        }
      }
      if (rule) context.permissions.upsert(rule);
    }

    sendAdminResponse(res, 200, {
      ok: true,
      revision: Date.now(),
      ticket,
    });
    return true;
  }

  if (path === '/api/permissions' && method === 'GET') {
    sendAdminResponse(res, 200, (context.permissions?.list?.() ?? []).map(permissionRuleDto));
    return true;
  }

  if (path === '/api/permissions' && method === 'POST') {
    const input = await readAdminBody(req);
    if (criticalPersistentRule(input)) {
      sendAdminResponse(res, 400, {
        error: {
          code: 'CRITICAL_RULE_FORBIDDEN',
          message: 'Critical operations cannot receive persistent always-allow rules',
        },
      });
      return true;
    }

    const existingRow = input.id ? context.permissions?.get?.(input.id) : null;
    const existing = existingRow ? permissionRuleDto(existingRow) : null;

    if (input.effect !== undefined && input.effect !== 'allow' && input.effect !== 'deny') {
      sendAdminResponse(res, 400, {
        error: { code: 'INVALID_EFFECT', message: 'Permission effect must be allow or deny' },
      });
      return true;
    }

    let predicate = input.predicate;
    if (typeof input.predicate_json === 'string') {
      try {
        predicate = JSON.parse(input.predicate_json);
      } catch {
        sendAdminResponse(res, 400, {
          error: {
            code: 'INVALID_PREDICATE',
            message: 'predicate_json is not valid JSON',
          },
        });
        return true;
      }
    }

    const effectiveVersion = input.version ?? (predicate ? 2 : (existing?.version ?? 1));
    if (effectiveVersion === 2 && predicate === undefined && !existing?.predicate_json) {
      sendAdminResponse(res, 400, {
        error: {
          code: 'INVALID_PREDICATE',
          message: 'V2 permission rules require a typed predicate',
        },
      });
      return true;
    }
    if (predicate !== undefined) {
      const validation = validateCommandRuleV2(predicate);
      if (!validation.ok) {
        sendAdminResponse(res, 400, {
          error: { code: 'INVALID_PREDICATE', message: validation.message },
        });
        return true;
      }
      predicate = validation.value;
    }

    const effectiveScope = input.scope ?? existing?.scope;
    if (
      effectiveScope !== undefined &&
      effectiveScope !== 'global' &&
      effectiveScope !== 'workspace' &&
      effectiveScope !== 'session'
    ) {
      sendAdminResponse(res, 400, {
        error: {
          code: 'INVALID_SCOPE',
          message: 'Permission scope must be global, workspace, or session',
        },
      });
      return true;
    }
    const effectiveWorkspaceId =
      input.workspaceId ?? existing?.workspaceId ?? existing?.workspace_id;
    if (effectiveScope === 'workspace' && !effectiveWorkspaceId) {
      sendAdminResponse(res, 400, {
        error: {
          code: 'WORKSPACE_REQUIRED',
          message: 'Workspace scope requires a valid workspaceId',
        },
      });
      return true;
    }
    const effectiveSessionId = input.sessionId ?? existing?.sessionId ?? existing?.session_id;
    if (effectiveScope === 'session' && !effectiveSessionId) {
      sendAdminResponse(res, 400, {
        error: {
          code: 'SESSION_REQUIRED',
          message: 'Session scope requires a valid sessionId',
        },
      });
      return true;
    }

    const rule = existing
      ? {
          ...existing,
          ...input,
          version: input.version ?? (predicate ? 2 : (existing.version ?? 1)),
          predicate_json: predicate
            ? JSON.stringify(predicate)
            : (input.predicate_json ?? existing.predicate_json),
          createdAt: existing.createdAt,
        }
      : {
          id: input.id ?? `perm_${randomUUID()}`,
          ...input,
          version: input.version ?? (predicate ? 2 : 1),
          predicate_json: predicate ? JSON.stringify(predicate) : input.predicate_json,
          createdAt: input.createdAt ?? new Date().toISOString(),
        };
    context.permissions.upsert(rule);
    sendAdminResponse(res, 200, {
      ok: true,
      revision: Date.now(),
      rule: permissionRuleDto(rule),
    });
    return true;
  }

  match = path.match(/^\/api\/permissions\/([^/]+)$/);
  if (match && method === 'DELETE') {
    const removed = context.permissions?.get?.(match[1]) ?? null;
    context.permissions?.delete(match[1]);
    sendAdminResponse(res, 200, { ok: true, removed });
    return true;
  }

  return false;
};
