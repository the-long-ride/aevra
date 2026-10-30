import { readAdminBody, sendAdminResponse } from './http.js';
import type { AdminRouteHandler } from './types.js';

const sendError = (res: any, status: number, code: string, message: string) =>
  sendAdminResponse(res, status, { error: { code, message } });
const sendNotFound = (res: any, message: string) => {
  sendError(res, 404, 'NOT_FOUND', message);
  return true;
};
const sendOk = (res: any, extra: Record<string, unknown> = {}) =>
  sendAdminResponse(res, 200, { ok: true, revision: Date.now(), ...extra });
const connectorTarget = (context: any, id: string) =>
  String(context.connectors?.list?.().find((c: any) => c.id === id)?.name ?? id);

function syncConnectorWorkspaceSessions(
  context: any,
  connectorId: string,
  connectorName: string,
  workspaceId: string,
  profileId?: string,
) {
  const actor = `connector:${connectorName}`;
  for (const s of context.sessions?.list?.() ?? []) {
    if (s.subject === connectorId || s.actor === actor) {
      try {
        if (profileId) context.sessions?.admitWorkspace?.(s.id, workspaceId, profileId);
        else context.sessions?.revokeWorkspace?.(s.id, workspaceId);
      } catch {
        /* best-effort */
      }
    }
  }
}

export const handleSessionConnectorRoutes: AdminRouteHandler = async (req, res, url, context) => {
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (path === '/api/diagnostics/mcp' && method === 'GET') {
    sendAdminResponse(res, 200, context.mcpDiagnostics?.() ?? null);
    return true;
  }

  if (path === '/api/sessions' && method === 'GET') {
    sendAdminResponse(res, 200, context.sessions?.list?.() ?? []);
    return true;
  }

  let match = path.match(/^\/api\/sessions\/([^/]+)\/yolo$/);
  if (match && (method === 'POST' || method === 'DELETE')) {
    const session = context.sessions?.get?.(match[1]);
    if (!session) return sendNotFound(res, 'Session not found');
    try {
      const result =
        method === 'POST'
          ? context.sessions.enableYolo(match[1])
          : context.sessions.disableYolo(match[1]);
      context.audit?.append?.({
        actor: 'admin',
        sessionId: match[1],
        operation: method === 'POST' ? 'session.yolo.enable' : 'session.yolo.disable',
        target: session.actor,
        result: 'ok',
        redactionCount: 0,
        class: 'security',
      });
      sendOk(res, { result });
    } catch (error) {
      sendError(
        res,
        400,
        'YOLO_NOT_ALLOWED',
        error instanceof Error ? error.message : String(error),
      );
    }
    return true;
  }

  match = path.match(/^\/api\/sessions\/([^/]+)\/revoke$/);
  if (match && method === 'POST') {
    context.sessions?.revoke?.(match[1]);
    sendOk(res);
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
    sendOk(res, { result });
    return true;
  }

  match = path.match(/^\/api\/sessions\/([^/]+)\/workspace\/([^/]+)$/);
  if (match && method === 'DELETE') {
    const sessionId = match[1]!;
    const workspaceId = decodeURIComponent(match[2]!);
    if (!context.sessions?.get?.(sessionId)) return sendNotFound(res, 'Session not found');
    context.sessions?.revokeWorkspace?.(sessionId, workspaceId);
    sendOk(res);
    return true;
  }

  if (path === '/api/admin-sessions' && method === 'GET') {
    sendAdminResponse(res, 200, context.bootstrap?.listSessions?.() ?? []);
    return true;
  }

  match = path.match(/^\/api\/admin-sessions\/([^/]+)\/revoke$/);
  if (match && method === 'POST') {
    context.bootstrap?.revokeSessionHash?.(match[1]);
    sendOk(res);
    return true;
  }

  if (path === '/api/connectors' && method === 'GET') {
    const enriched = (context.connectors?.list?.() ?? []).map((connector: any) => {
      const grants =
        context.connectors?.listWorkspaceGrants?.(connector.id) ?? connector.workspaceGrants ?? [];
      const wsIds = Array.from(
        new Set([
          ...grants.map((g: any) => g.workspaceId),
          ...(connector.workspaceId ? [connector.workspaceId] : []),
        ]),
      );
      return {
        ...connector,
        workspaceIds: wsIds,
        workspaceGrants: grants.length
          ? grants
          : wsIds.map((id) => ({
              workspaceId: id,
              profileId: connector.profileCap ?? 'read-only',
            })),
      };
    });
    sendAdminResponse(res, 200, enriched);
    return true;
  }

  if (path === '/api/connectors' && method === 'POST') {
    const input = await readAdminBody(req);
    const name = String(input.name ?? '').trim();
    if (!name) {
      sendError(res, 400, 'INVALID_CONNECTOR', 'Connector name is required');
      return true;
    }
    if (context.connectors?.list?.().some((connector: any) => connector.name === name)) {
      sendError(res, 409, 'CONNECTOR_EXISTS', `Connector ${name} already exists`);
      return true;
    }
    let expiresAt: string | null = null;
    if (typeof input.expiresAt === 'string' && input.expiresAt) {
      const time = Date.parse(input.expiresAt);
      if (Number.isNaN(time)) {
        sendError(res, 400, 'INVALID_CONNECTOR', 'expiresAt must be an ISO date');
        return true;
      }
      expiresAt = new Date(time).toISOString();
    }
    const defaultProfile = String(input.profileCap || 'read-only');
    const rawWsIds = Array.isArray(input.workspaceIds)
      ? input.workspaceIds.map(String).filter(Boolean)
      : input.workspaceId
        ? [String(input.workspaceId)]
        : [];
    const workspaceGrants = Array.isArray(input.workspaceGrants)
      ? input.workspaceGrants.map((g: any) => ({
          workspaceId: String(g.workspaceId),
          profileId: String(g.profileId || defaultProfile),
        }))
      : rawWsIds.map((workspaceId) => ({ workspaceId, profileId: defaultProfile }));

    const { connector, token } = context.connectors.create({
      name,
      workspaceId: rawWsIds[0] ?? (input.workspaceId ? String(input.workspaceId) : null),
      workspaceIds: rawWsIds,
      workspaceGrants,
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

  match = path.match(/^\/api\/connectors\/([^/]+)\/control(?:\/([^/]+))?$/);
  if (match && ['GET', 'POST', 'DELETE'].includes(method)) {
    const connectorId = decodeURIComponent(match[1]!);
    const connector = context.connectors
      ?.list?.()
      .find((entry: any) => String(entry.id) === connectorId);
    if (!connector) {
      sendError(res, 404, 'NOT_FOUND', 'Connector not found');
      return true;
    }
    const identity = { kind: 'connector' as const, key: connectorId };
    if (method === 'GET') {
      const grants = context.hostControlAccess?.list?.(identity) ?? [];
      sendAdminResponse(res, 200, {
        connectionId: connectorId,
        browser: grants.some(
          (grant: any) => grant.capability === 'browser.control' && !grant.revokedAt,
        ),
        desktop: grants.some(
          (grant: any) => grant.capability === 'desktop.control' && !grant.revokedAt,
        ),
      });
      return true;
    }
    const body = method === 'POST' ? await readAdminBody(req) : null;
    const capability = decodeURIComponent(match[2] ?? String(body?.capability ?? ''));
    if (capability !== 'browser.control' && capability !== 'desktop.control') {
      sendError(res, 400, 'INVALID_REQUEST', 'Invalid control capability');
      return true;
    }
    if (method === 'POST') context.hostControlAccess?.grant?.(identity, capability, 'admin');
    else await context.hostControlAccess?.revoke?.(identity, capability);
    context.audit?.append?.({
      actor: 'admin',
      connectionId: connectorId,
      operation: method === 'POST' ? 'connection.control_grant' : 'connection.control_revoke',
      target: capability,
      result: 'ok',
      redactionCount: 0,
      class: 'security',
    });
    sendOk(res);
    return true;
  }

  match = path.match(/^\/api\/connectors\/([^/]+)\/workspaces(?:\/([^/]+))?$/);
  if (match && ['GET', 'POST', 'DELETE'].includes(method)) {
    const connectorId = decodeURIComponent(match[1]!);
    const connector = context.connectors
      ?.list?.()
      .find((entry: any) => String(entry.id) === connectorId);
    if (!connector) {
      sendError(res, 404, 'NOT_FOUND', 'Connector not found');
      return true;
    }
    if (method === 'GET') {
      const grants =
        context.connectors?.listWorkspaceGrants?.(connectorId) ?? connector.workspaceGrants ?? [];
      sendAdminResponse(res, 200, {
        connectorId,
        grants,
        workspaceIds: grants.map((g: any) => g.workspaceId),
      });
      return true;
    }
    if (method === 'POST') {
      const body = await readAdminBody(req);
      const workspaceId = String(body.workspaceId ?? '').trim();
      const profileId = String(body.profileId ?? connector.profileCap ?? 'read-only').trim();
      if (!workspaceId) {
        sendError(res, 400, 'INVALID_REQUEST', 'workspaceId required');
        return true;
      }
      context.connectors?.grantWorkspace?.(connectorId, workspaceId, profileId);
      syncConnectorWorkspaceSessions(context, connectorId, connector.name, workspaceId, profileId);
      context.audit?.append?.({
        actor: 'admin',
        operation: 'connector.workspace_grant',
        target: `${connectorId}:${workspaceId}`,
        result: 'ok',
        redactionCount: 0,
        class: 'normal',
      });
      sendOk(res);
      return true;
    }
    if (method === 'DELETE') {
      const workspaceId = decodeURIComponent(match[2] ?? '');
      if (!workspaceId) {
        sendError(res, 400, 'INVALID_REQUEST', 'workspaceId required');
        return true;
      }
      context.connectors?.revokeWorkspace?.(connectorId, workspaceId);
      syncConnectorWorkspaceSessions(context, connectorId, connector.name, workspaceId);
      context.audit?.append?.({
        actor: 'admin',
        operation: 'connector.workspace_revoke',
        target: `${connectorId}:${workspaceId}`,
        result: 'ok',
        redactionCount: 0,
        class: 'normal',
      });
      sendOk(res);
      return true;
    }
  }

  match = path.match(/^\/api\/connectors\/([^/]+)\/rotate$/);
  if (match && method === 'POST') {
    const connectorId = match[1]!;
    const token = context.connectors?.rotate?.(connectorId);
    if (!token) return sendNotFound(res, 'Connector not found');
    const target = connectorTarget(context, connectorId);
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
    const connectorId = match[1]!;
    const target = connectorTarget(context, connectorId);
    context.connectors?.revoke?.(connectorId);
    context.oauth?.deleteClient?.(connectorId, true);
    context.audit?.append?.({
      actor: 'admin',
      operation: 'connector.revoke',
      target,
      result: 'ok',
      redactionCount: 0,
      class: 'security',
    });
    sendOk(res);
    return true;
  }

  return false;
};
