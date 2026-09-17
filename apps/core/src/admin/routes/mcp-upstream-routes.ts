import { readAdminBody, sendAdminResponse } from './http.js';
import { UpstreamInputError, parseUpstreamInput, publicUpstream } from './mcp-upstream-input.js';
import type { AdminRouteHandler } from './types.js';

const PREFIX = '/api/mcp/upstreams';
const ITEM = /^\/api\/mcp\/upstreams\/([^/]+)$/;
const TEST = /^\/api\/mcp\/upstreams\/([^/]+)\/test$/;
const ACKNOWLEDGE = /^\/api\/mcp\/upstreams\/([^/]+)\/acknowledge$/;
const STATUS_BY_CODE: Record<string, number> = {
  UPSTREAM_NOT_FOUND: 404,
  NOT_FOUND: 404,
  UPSTREAM_EXISTS: 409,
  MCP_UPSTREAM_NAME_TAKEN: 409,
  UPSTREAM_HANDSHAKE_FAILED: 400,
  MCP_UPSTREAM_HANDSHAKE_FAILED: 400,
};

function sendFailure(res: Parameters<AdminRouteHandler>[1], cause: unknown): void {
  const error = cause as { code?: string; message?: string };
  const code =
    cause instanceof UpstreamInputError ? cause.code : (error.code ?? 'MCP_UPSTREAM_FAILED');
  sendAdminResponse(res, STATUS_BY_CODE[code] ?? 400, {
    error: { code, message: error.message ?? 'The upstream request failed' },
  });
}

export const handleMcpUpstreamRoutes: AdminRouteHandler = async (req, res, url, context) => {
  if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) return false;
  const method = req.method ?? 'GET';
  const upstreams = context.mcpUpstreams;
  if (!upstreams) {
    sendAdminResponse(res, 503, {
      error: {
        code: 'MCP_UPSTREAM_UNAVAILABLE',
        message: 'The MCP upstream registry is unavailable',
      },
    });
    return true;
  }
  try {
    if (url.pathname === PREFIX && method === 'GET') {
      const records = await upstreams.list();
      sendAdminResponse(res, 200, { upstreams: records.map(publicUpstream) });
      return true;
    }
    if (url.pathname === PREFIX && method === 'POST') {
      const input = parseUpstreamInput(await readAdminBody(req));
      sendAdminResponse(res, 201, publicUpstream(await upstreams.create(input)));
      return true;
    }
    const test = TEST.exec(url.pathname);
    if (test && method === 'POST') {
      sendAdminResponse(res, 200, await upstreams.test(test[1]!));
      return true;
    }
    const acknowledge = ACKNOWLEDGE.exec(url.pathname);
    if (acknowledge && method === 'POST') {
      sendAdminResponse(res, 200, publicUpstream(await upstreams.acknowledge(acknowledge[1]!)));
      return true;
    }
    const item = ITEM.exec(url.pathname);
    if (item && method === 'DELETE') {
      await upstreams.remove(item[1]!);
      sendAdminResponse(res, 200, { ok: true });
      return true;
    }
    if (item && method === 'POST') {
      const input = parseUpstreamInput(await readAdminBody(req));
      sendAdminResponse(res, 200, publicUpstream(await upstreams.update(item[1]!, input)));
      return true;
    }
    return false;
  } catch (cause) {
    sendFailure(res, cause);
    return true;
  }
};
