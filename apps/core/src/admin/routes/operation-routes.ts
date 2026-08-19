import { readAdminBody, sendAdminResponse } from './http.js';
import type { AdminRouteHandler } from './types.js';

export const handleOperationRoutes: AdminRouteHandler = async (req, res, url, context) => {
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (path === '/api/processes' && method === 'GET') {
    sendAdminResponse(res, 200, context.processes?.listLocal?.() ?? []);
    return true;
  }

  let match = path.match(/^\/api\/processes\/([^/]+)\/(stop|restart|forget)$/);
  if (match && method === 'POST') {
    const result = await context.processes?.localAction?.(match[1], match[2]);
    sendAdminResponse(res, 200, {
      ok: true,
      revision: Date.now(),
      result,
    });
    return true;
  }

  if (path === '/api/changes' && method === 'GET') {
    sendAdminResponse(res, 200, context.changes?.list?.() ?? []);
    return true;
  }

  match = path.match(/^\/api\/changes\/([^/]+)\/(commit|rollback)$/);
  if (match && method === 'POST') {
    const input = await readAdminBody(req);
    const result =
      match[2] === 'commit'
        ? await context.changes.commit(match[1])
        : await context.changes.rollback(match[1], {
            force: Boolean(input.force),
            skipPaths: Array.isArray(input.skipPaths) ? input.skipPaths : [],
          });
    sendAdminResponse(res, 200, {
      ok: true,
      revision: Date.now(),
      result,
    });
    return true;
  }

  match = path.match(/^\/api\/changes\/([^/]+)$/);
  if (match && method === 'PATCH') {
    const input = await readAdminBody(req);
    const result = context.changes?.rename?.(match[1], String(input.name ?? ''));
    sendAdminResponse(res, 200, {
      ok: true,
      revision: Date.now(),
      result,
    });
    return true;
  }

  if (path === '/api/metrics' && method === 'GET') {
    sendAdminResponse(res, 200, context.metrics?.snapshot?.() ?? []);
    return true;
  }

  if (path === '/api/audit/verify' && method === 'GET') {
    sendAdminResponse(res, 200, context.audit?.verify?.() ?? { valid: false });
    return true;
  }

  if (path === '/api/audit/export' && method === 'GET') {
    const format = url.searchParams.get('format') === 'jsonl' ? 'jsonl' : 'json';
    const text =
      format === 'jsonl'
        ? (context.audit?.exportJsonl?.() ?? '')
        : (context.audit?.exportJson?.() ?? '[]');
    if (format === 'jsonl') {
      sendAdminResponse(res, 200, text, 'application/x-ndjson');
    } else {
      sendAdminResponse(res, 200, JSON.parse(text), 'application/json');
    }
    return true;
  }

  return false;
};
