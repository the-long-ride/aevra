import { sendAdminResponse } from './http.js';
import type { AdminRouteHandler } from './types.js';

export const handleConnectionRoutes: AdminRouteHandler = async (_req, res, url, context) => {
  const method = _req.method ?? 'GET';
  const path = url.pathname;

  if (path === '/api/connections' && method === 'GET') {
    sendAdminResponse(res, 200, context.connections?.list?.() ?? []);
    return true;
  }

  const match = path.match(/^\/api\/connections\/([^/]+)\/revoke$/);
  if (match && method === 'POST') {
    const connectionId = decodeURIComponent(match[1]!);
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

  return false;
};
