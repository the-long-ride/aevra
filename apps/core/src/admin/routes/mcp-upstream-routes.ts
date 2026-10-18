import { readAdminBody, sendAdminResponse } from './http.js';
import { UpstreamInputError, parseUpstreamInput, publicUpstream } from './mcp-upstream-input.js';
import type { AdminApiContext, AdminRouteHandler } from './types.js';

const PREFIX = '/api/mcp/upstreams';
const ITEM = /^\/api\/mcp\/upstreams\/([^/]+)$/;
const TEST = /^\/api\/mcp\/upstreams\/([^/]+)\/test$/;
const TOGGLE = /^\/api\/mcp\/upstreams\/([^/]+)\/(enable|disable)$/;
const ACKNOWLEDGE = /^\/api\/mcp\/upstreams\/([^/]+)\/acknowledge$/;
const STATUS_BY_CODE: Record<string, number> = {
  UPSTREAM_NOT_FOUND: 404,
  NOT_FOUND: 404,
  UPSTREAM_EXISTS: 409,
  MCP_UPSTREAM_NAME_TAKEN: 409,
  UPSTREAM_HANDSHAKE_FAILED: 400,
  MCP_UPSTREAM_HANDSHAKE_FAILED: 400,
  MCP_UPSTREAM_DISABLED: 409,
  MCP_UPSTREAM_CATALOG_CHANGED: 409,
};

function auditToggle(
  context: AdminApiContext,
  name: string,
  enabled: boolean,
  warning?: string,
): void {
  context.audit?.append?.({
    actor: 'admin',
    operation: enabled ? 'mcp.upstream.enable' : 'mcp.upstream.disable',
    target: name,
    result: warning ? 'warning' : 'ok',
    redactionCount: 0,
    class: 'normal',
  });
}

function auditAcknowledge(context: AdminApiContext, name: string): void {
  context.audit?.append?.({
    actor: 'admin',
    operation: 'mcp.upstream.acknowledge',
    target: name,
    result: 'ok',
    redactionCount: 0,
    class: 'normal',
  });
}

/** A toggle that took effect but could not fully stop or verify the server says why. */
function withWarning<T extends object>(body: T, warning?: string): T & { warning?: string } {
  return warning ? { ...body, warning } : body;
}

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
      try {
        await upstreams.reconcileForList?.();
      } catch {
        // Reconcile is best effort; the list below still answers from stored state.
      }
      const records = await upstreams.list();
      sendAdminResponse(res, 200, { upstreams: records.map(publicUpstream) });
      return true;
    }
    if (url.pathname === PREFIX && method === 'POST') {
      const input = parseUpstreamInput(await readAdminBody(req));
      if (input.enabled === false)
        throw new UpstreamInputError(
          'UPSTREAM_ENABLED_INVALID',
          'A server is added enabled so its catalog can be verified; disable it afterwards',
        );
      sendAdminResponse(res, 201, publicUpstream(await upstreams.create(input)));
      return true;
    }
    const test = TEST.exec(url.pathname);
    if (test && method === 'POST') {
      sendAdminResponse(res, 200, await upstreams.test(test[1]!));
      return true;
    }
    const toggle = TOGGLE.exec(url.pathname);
    if (toggle && method === 'POST') {
      const enabled = toggle[2] === 'enable';
      const { record, changed, warning } = await upstreams.setEnabled(toggle[1]!, enabled);
      if (changed) auditToggle(context, record.name, enabled, warning);
      sendAdminResponse(res, 200, withWarning(publicUpstream(record), warning));
      return true;
    }
    const acknowledge = ACKNOWLEDGE.exec(url.pathname);
    if (acknowledge && method === 'POST') {
      const body = await readAdminBody(req);
      const record = await upstreams.acknowledge(
        acknowledge[1]!,
        typeof body.expectedFingerprint === 'string' ? body.expectedFingerprint : undefined,
      );
      auditAcknowledge(context, record.name);
      sendAdminResponse(res, 200, publicUpstream(record));
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
      const { record, changed, warning } = await upstreams.updateReporting(item[1]!, input);
      if (changed) auditToggle(context, record.name, record.enabled, warning);
      sendAdminResponse(res, 200, withWarning(publicUpstream(record), warning));
      return true;
    }
    return false;
  } catch (cause) {
    sendFailure(res, cause);
    return true;
  }
};
