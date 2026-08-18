import { readAdminBody, sendAdminResponse } from './http.js';
import type { AdminRouteHandler } from './types.js';

export const handleSessionConnectorRoutes: AdminRouteHandler = async (
  req,
  res,
  url,
  context,
) => {
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (path === '/api/sessions' && method === 'GET') {
    sendAdminResponse(res, 200, context.sessions?.list?.() ?? []);
    return true;
  }

  let match = path.match(/^\/api\/sessions\/([^/]+)\/revoke$/);
  if (match && method === 'POST') {
    context.sessions?.revoke?.(match[1]);
    sendAdminResponse(res, 200, { ok: true, revision: Date.now() });
    return true;
  }

  match = path.match(/^\/api\/sessions\/([^/]+)\/workspace$/);
  if (match && method === 'POST') {
    const input = await readAdminBody(req);
    const result = await context.sessions?.switchWorkspace?.(
      match[1],
      String(input.workspaceId),
      input.profileId,
      input.timeoutMs,
    );
    sendAdminResponse(res, 200, {
      ok: true,
      revision: Date.now(),
      result,
    });
    return true;
  }

  if (path === '/api/admin-sessions' && method === 'GET') {
    sendAdminResponse(res, 200, context.bootstrap?.listSessions?.() ?? []);
    return true;
  }

  match = path.match(/^\/api\/admin-sessions\/([^/]+)\/revoke$/);
  if (match && method === 'POST') {
    context.bootstrap?.revokeSessionHash?.(match[1]);
    sendAdminResponse(res, 200, { ok: true, revision: Date.now() });
    return true;
  }

  if (path === '/api/connectors' && method === 'GET') {
    sendAdminResponse(res, 200, context.connectors?.list?.() ?? []);
    return true;
  }

  if (path === '/api/connectors' && method === 'POST') {
    const input = await readAdminBody(req);
    const name = String(input.name ?? '').trim();
    if (!name) {
      sendAdminResponse(res, 400, {
        error: {
          code: 'INVALID_CONNECTOR',
          message: 'Connector name is required',
        },
      });
      return true;
    }

    if (
      context.connectors
        ?.list?.()
        .some((connector: any) => connector.name === name)
    ) {
      sendAdminResponse(res, 409, {
        error: {
          code: 'CONNECTOR_EXISTS',
          message: `Connector ${name} already exists`,
        },
      });
      return true;
    }

    let expiresAt: string | null = null;
    if (typeof input.expiresAt === 'string' && input.expiresAt) {
      const time = Date.parse(input.expiresAt);
      if (Number.isNaN(time)) {
        sendAdminResponse(res, 400, {
          error: {
            code: 'INVALID_CONNECTOR',
            message: 'expiresAt must be an ISO date',
          },
        });
        return true;
      }
      expiresAt = new Date(time).toISOString();
    }

    const { connector, token } = context.connectors.create({
      name,
      workspaceId: input.workspaceId ? String(input.workspaceId) : null,
      profileCap: input.profileCap ? String(input.profileCap) : null,
      expiresAt,
    });
    context.audit?.append?.({
      actor: 'admin',
      operation: 'connector.create',
      target: name,
      result: 'ok',
      redactionCount: 0,
      class: 'security',
    });
    sendAdminResponse(res, 201, { ...connector, token });
    return true;
  }

  match = path.match(/^\/api\/connectors\/([^/]+)\/rotate$/);
  if (match && method === 'POST') {
    const token = context.connectors?.rotate?.(match[1]);
    if (!token) {
      sendAdminResponse(res, 404, {
        error: { code: 'NOT_FOUND', message: 'Connector not found' },
      });
      return true;
    }
    const target = String(
      context.connectors
        ?.list?.()
        .find((connector: any) => connector.id === match[1])?.name ?? match[1],
    );
    context.audit?.append?.({
      actor: 'admin',
      operation: 'connector.rotate',
      target,
      result: 'ok',
      redactionCount: 0,
      class: 'security',
    });
    sendAdminResponse(res, 200, { ok: true, token });
    return true;
  }

  match = path.match(/^\/api\/connectors\/([^/]+)$/);
  if (match && method === 'DELETE') {
    const target =
      context.connectors
        ?.list?.()
        .find((connector: any) => connector.id === match[1])?.name ?? match[1];
    context.connectors?.revoke?.(match[1]);
    context.audit?.append?.({
      actor: 'admin',
      operation: 'connector.revoke',
      target: String(target),
      result: 'ok',
      redactionCount: 0,
      class: 'security',
    });
    sendAdminResponse(res, 200, { ok: true, revision: Date.now() });
    return true;
  }

  return false;
};
