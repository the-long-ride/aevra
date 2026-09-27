import { readAdminBody, sendAdminResponse } from './http.js';
import type { AdminRouteHandler } from './types.js';

export const handleConnectionRoutes: AdminRouteHandler = async (_req, res, url, context) => {
  const method = _req.method ?? 'GET';
  const path = url.pathname;

  if (path === '/api/connections' && method === 'GET') {
    sendAdminResponse(res, 200, context.connections?.list?.() ?? []);
    return true;
  }

  const controlMatch = path.match(/^\/api\/connections\/([^/]+)\/control$/);
  if (controlMatch && (method === 'GET' || method === 'POST')) {
    const connectionId = decodeURIComponent(controlMatch[1]!);
    try {
      if (method === 'GET') {
        sendAdminResponse(
          res,
          200,
          context.connections?.listControl?.(connectionId) ?? {
            connectionId,
            browser: false,
            desktop: false,
          },
        );
        return true;
      }
      const body = await readAdminBody(_req);
      const capability = String(body?.capability ?? '');
      if (capability !== 'browser.control' && capability !== 'desktop.control') {
        sendAdminResponse(res, 400, {
          error: { code: 'INVALID_REQUEST', message: 'Invalid control capability' },
        });
        return true;
      }
      context.connections?.grantControl?.(connectionId, capability);
      context.audit?.append?.({
        actor: 'admin',
        connectionId,
        operation: 'connection.control_grant',
        target: `${connectionId}:${capability}`,
        result: 'ok',
        redactionCount: 0,
        class: 'security',
      });
      sendAdminResponse(res, 200, { ok: true, revision: Date.now() });
    } catch (e: any) {
      sendAdminResponse(res, e?.code === 'NOT_FOUND' ? 404 : 400, {
        error: { code: e?.code ?? 'INVALID_REQUEST', message: e?.message ?? 'Request failed' },
      });
    }
    return true;
  }

  const revokeControlMatch = path.match(/^\/api\/connections\/([^/]+)\/control\/([^/]+)$/);
  if (revokeControlMatch && method === 'DELETE') {
    const connectionId = decodeURIComponent(revokeControlMatch[1]!);
    const capability = decodeURIComponent(revokeControlMatch[2]!);
    if (capability !== 'browser.control' && capability !== 'desktop.control') {
      sendAdminResponse(res, 400, {
        error: { code: 'INVALID_REQUEST', message: 'Invalid control capability' },
      });
      return true;
    }
    try {
      await context.connections?.revokeControl?.(connectionId, capability);
      context.audit?.append?.({
        actor: 'admin',
        connectionId,
        operation: 'connection.control_revoke',
        target: `${connectionId}:${capability}`,
        result: 'ok',
        redactionCount: 0,
        class: 'security',
      });
      sendAdminResponse(res, 200, { ok: true, revision: Date.now() });
    } catch (e: any) {
      sendAdminResponse(res, e?.code === 'NOT_FOUND' ? 404 : 400, {
        error: { code: e?.code ?? 'INVALID_REQUEST', message: e?.message ?? 'Request failed' },
      });
    }
    return true;
  }
  const revokeConnMatch = path.match(/^\/api\/connections\/([^/]+)\/revoke$/);
  if (revokeConnMatch && method === 'POST') {
    const connectionId = decodeURIComponent(revokeConnMatch[1]!);
    if (!context.connections?.revoke?.(connectionId)) {
      sendAdminResponse(res, 404, {
        error: { code: 'NOT_FOUND', message: 'Connection not found' },
      });
      return true;
    }
    context.audit?.append?.({
      actor: 'admin',
      operation: 'connection.revoke',
      target: connectionId,
      result: 'ok',
      redactionCount: 0,
      class: 'security',
    });
    sendAdminResponse(res, 200, { ok: true, revision: Date.now() });
    return true;
  }

  const grantWsMatch = path.match(/^\/api\/connections\/([^/]+)\/workspaces$/);
  if (grantWsMatch && method === 'POST') {
    const connectionId = decodeURIComponent(grantWsMatch[1]!);
    const body = await readAdminBody(_req);
    const workspaceId = String(body?.workspaceId ?? '');
    const profileId = String(body?.profileId ?? 'read-only');
    if (!workspaceId) {
      sendAdminResponse(res, 400, {
        error: { code: 'INVALID_REQUEST', message: 'workspaceId required' },
      });
      return true;
    }
    try {
      context.connections?.grantWorkspace?.(connectionId, workspaceId, profileId);
      context.audit?.append?.({
        actor: 'admin',
        operation: 'connection.workspace_grant',
        target: `${connectionId}:${workspaceId}`,
        result: 'ok',
        redactionCount: 0,
        class: 'normal',
      });
      sendAdminResponse(res, 200, { ok: true, revision: Date.now() });
    } catch (e: any) {
      const status =
        e?.status ?? (e?.code === 'NOT_FOUND' ? 404 : e?.code === 'CONFLICT' ? 409 : 400);
      const code =
        e?.code ?? (status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : 'INVALID_REQUEST');
      sendAdminResponse(res, status, { error: { code, message: e.message } });
    }
    return true;
  }

  const revokeWsMatch = path.match(/^\/api\/connections\/([^/]+)\/workspaces\/([^/]+)$/);
  if (revokeWsMatch && (method === 'DELETE' || method === 'POST')) {
    const connectionId = decodeURIComponent(revokeWsMatch[1]!);
    const workspaceId = decodeURIComponent(revokeWsMatch[2]!);
    try {
      const removed = context.connections?.revokeWorkspace?.(connectionId, workspaceId);
      if (!removed) {
        sendAdminResponse(res, 404, {
          error: { code: 'NOT_FOUND', message: 'Workspace grant not found' },
        });
        return true;
      }
      context.audit?.append?.({
        actor: 'admin',
        operation: 'connection.workspace_revoke',
        target: `${connectionId}:${workspaceId}`,
        result: 'ok',
        redactionCount: 0,
        class: 'normal',
      });
      sendAdminResponse(res, 200, { ok: true, revision: Date.now() });
    } catch (e: any) {
      const status =
        e?.status ?? (e?.code === 'NOT_FOUND' ? 404 : e?.code === 'CONFLICT' ? 409 : 400);
      const code =
        e?.code ?? (status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : 'INVALID_REQUEST');
      sendAdminResponse(res, status, { error: { code, message: e.message } });
    }
    return true;
  }

  return false;
};
