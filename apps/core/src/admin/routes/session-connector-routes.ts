import { readAdminBody, sendAdminResponse } from './http.js';
import type { AdminRouteHandler } from './types.js';

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
    if (!session) {
      sendAdminResponse(res, 404, {
        error: { code: 'NOT_FOUND', message: 'Session not found' },
      });
      return true;
    }
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
      sendAdminResponse(res, 200, { ok: true, revision: Date.now(), result });
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

  match = path.match(/^\/api\/sessions\/([^/]+)\/revoke$/);
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

  match = path.match(/^\/api\/sessions\/([^/]+)\/workspace\/([^/]+)$/);
  if (match && method === 'DELETE') {
    const sessionId = match[1]!;
    const workspaceId = decodeURIComponent(match[2]!);
    const session = context.sessions?.get?.(sessionId);
    if (!session) {
      sendAdminResponse(res, 404, {
        error: { code: 'NOT_FOUND', message: 'Session not found' },
      });
      return true;
    }
    context.sessions?.revokeWorkspace?.(sessionId, workspaceId);
    sendAdminResponse(res, 200, { ok: true, revision: Date.now() });
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
    const list = context.connectors?.list?.() ?? [];
    const enriched = list.map((connector: any) => {
      const grants =
        context.connectors?.listWorkspaceGrants?.(connector.id) ??
        connector.workspaceGrants ??
        [];
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
      sendAdminResponse(res, 400, {
        error: {
          code: 'INVALID_CONNECTOR',
          message: 'Connector name is required',
        },
      });
      return true;
    }

    if (context.connectors?.list?.().some((connector: any) => connector.name === name)) {
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

    const rawWsIds = Array.isArray(input.workspaceIds)
      ? input.workspaceIds.map(String).filter(Boolean)
      : input.workspaceId
        ? [String(input.workspaceId)]
        : [];
    const workspaceGrants = Array.isArray(input.workspaceGrants)
      ? input.workspaceGrants.map((g: any) => ({
          workspaceId: String(g.workspaceId),
          profileId: String(g.profileId || input.profileCap || 'read-only'),
        }))
      : rawWsIds.map((wid) => ({
          workspaceId: wid,
          profileId: String(input.profileCap || 'read-only'),
        }));

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
      sendAdminResponse(res, 404, {
        error: { code: 'NOT_FOUND', message: 'Connector not found' },
      });
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
      sendAdminResponse(res, 400, {
        error: { code: 'INVALID_REQUEST', message: 'Invalid control capability' },
      });
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
    sendAdminResponse(res, 200, { ok: true, revision: Date.now() });
    return true;
  }

  match = path.match(/^\/api\/connectors\/([^/]+)\/workspaces(?:\/([^/]+))?$/);
  if (match && ['GET', 'POST', 'DELETE'].includes(method)) {
    const connectorId = decodeURIComponent(match[1]!);
    const connector = context.connectors
      ?.list?.()
      .find((entry: any) => String(entry.id) === connectorId);
    if (!connector) {
      sendAdminResponse(res, 404, {
        error: { code: 'NOT_FOUND', message: 'Connector not found' },
      });
      return true;
    }

    if (method === 'GET') {
      const grants =
        context.connectors?.listWorkspaceGrants?.(connectorId) ??
        connector.workspaceGrants ??
        [];
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
        sendAdminResponse(res, 400, {
          error: { code: 'INVALID_REQUEST', message: 'workspaceId required' },
        });
        return true;
      }
      context.connectors?.grantWorkspace?.(connectorId, workspaceId, profileId);
      const actor = `connector:${connector.name}`;
      const sessions = context.sessions?.list?.() ?? [];
      for (const s of sessions) {
        if (s.subject === connectorId || s.actor === actor) {
          try {
            context.sessions?.admitWorkspace?.(s.id, workspaceId, profileId);
          } catch {
            /* best-effort */
          }
        }
      }
      context.audit?.append?.({
        actor: 'admin',
        operation: 'connector.workspace_grant',
        target: `${connectorId}:${workspaceId}`,
        result: 'ok',
        redactionCount: 0,
        class: 'normal',
      });
      sendAdminResponse(res, 200, { ok: true, revision: Date.now() });
      return true;
    }

    if (method === 'DELETE') {
      const workspaceId = decodeURIComponent(match[2] ?? '');
      if (!workspaceId) {
        sendAdminResponse(res, 400, {
          error: { code: 'INVALID_REQUEST', message: 'workspaceId required' },
        });
        return true;
      }
      context.connectors?.revokeWorkspace?.(connectorId, workspaceId);
      const actor = `connector:${connector.name}`;
      const sessions = context.sessions?.list?.() ?? [];
      for (const s of sessions) {
        if (s.subject === connectorId || s.actor === actor) {
          try {
            context.sessions?.revokeWorkspace?.(s.id, workspaceId);
          } catch {
            /* best-effort */
          }
        }
      }
      context.audit?.append?.({
        actor: 'admin',
        operation: 'connector.workspace_revoke',
        target: `${connectorId}:${workspaceId}`,
        result: 'ok',
        redactionCount: 0,
        class: 'normal',
      });
      sendAdminResponse(res, 200, { ok: true, revision: Date.now() });
      return true;
    }
  }

  match = path.match(/^\/api\/connectors\/([^/]+)\/rotate$/);
  if (match && method === 'POST') {
    const connectorId = match[1]!;
    const token = context.connectors?.rotate?.(connectorId);
    if (!token) {
      sendAdminResponse(res, 404, {
        error: { code: 'NOT_FOUND', message: 'Connector not found' },
      });
      return true;
    }
    const target = String(
      context.connectors?.list?.().find((connector: any) => connector.id === connectorId)?.name ??
        connectorId,
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
    const connectorId = match[1]!;
    const target =
      context.connectors?.list?.().find((connector: any) => connector.id === connectorId)?.name ??
      connectorId;
    context.connectors?.revoke?.(connectorId);
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
