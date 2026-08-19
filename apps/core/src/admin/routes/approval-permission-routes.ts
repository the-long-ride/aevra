import { randomUUID } from 'node:crypto';
import { permissionRuleFromApproval } from '../approval-permissions.js';
import { readAdminBody, sendAdminResponse } from './http.js';
import { criticalPersistentRule } from './route-state.js';
import type { AdminRouteHandler } from './types.js';

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
    if (before.state !== 'PENDING') {
      sendAdminResponse(res, 409, {
        error: { code: 'INVALID_STATE', message: `Cannot enable YOLO for ${before.state} request` },
      });
      return true;
    }
    try {
      const yolo = context.sessions?.enableYolo?.(before.sessionId);
      let ticket;
      try {
        ticket = context.approvals.approve(match[1], 'once');
      } catch (error) {
        context.sessions?.disableYolo?.(before.sessionId);
        throw error;
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
    const admission = before?.operation?.family === 'workspace:select';
    const scope = admission ? 'once' : (input.scope ?? 'once');
    const ticket =
      match[2] === 'approve'
        ? context.approvals.approve(match[1], scope)
        : context.approvals.deny(match[1]);

    if (match[2] === 'approve' && !admission && context.permissions) {
      const rule = permissionRuleFromApproval(
        ticket,
        scope,
        `perm_${randomUUID()}`,
        new Date().toISOString(),
      );
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
    sendAdminResponse(res, 200, context.permissions?.list?.() ?? []);
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

    const rule = {
      id: input.id ?? `perm_${randomUUID()}`,
      ...input,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    context.permissions.upsert(rule);
    sendAdminResponse(res, 200, {
      ok: true,
      revision: Date.now(),
      rule,
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
