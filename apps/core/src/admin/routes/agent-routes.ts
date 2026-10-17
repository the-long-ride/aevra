import path from 'node:path';
import { rootKey } from '../../../../../packages/agent-integration/src/claude-project-key.js';
import { readAdminBody, sendAdminResponse } from './http.js';
import type { AdminApiContext, AdminRouteHandler } from './types.js';

const OPERATIONS = ['install', 'uninstall', 'status'];

// The engine's own root identity, so a registration joins exactly the workspace it would treat
// as the same folder. A stored hostRoot is resolved first (trailing separator, `..` segments).
const sameRoot = (hostRoot: unknown, workspaceRoot: unknown) =>
  typeof hostRoot === 'string' &&
  typeof workspaceRoot === 'string' &&
  rootKey(path.resolve(hostRoot)) === rootKey(workspaceRoot);

function failure(
  res: Parameters<AdminRouteHandler>[1],
  status: number,
  code: string,
  message: string,
): true {
  sendAdminResponse(res, status, { error: { code, message } });
  return true;
}

// Adds last-used time (joined through the connector the registration issued) and, for a
// workspace registration, the Aevra workspace whose folder it was installed into. A registration
// whose connector is gone (revoked or deleted elsewhere) is broken, not unused: it is marked
// `connectorMissing` and incomplete. Without a connector list nothing is known to be missing.
function decorate(context: AdminApiContext, registrations: any[]) {
  const connectors: any[] | undefined = context.connectors?.list
    ? context.connectors.list()
    : undefined;
  const workspaces: any[] = context.workspaces?.listLocal?.() ?? [];
  return registrations.map((registration) => {
    const connector = connectors?.find((row) => row.id === registration.credentialId);
    const workspace =
      registration.scope === 'workspace'
        ? workspaces.find((row) => sameRoot(row.hostRoot, registration.workspaceRoot))
        : undefined;
    const missing = connectors !== undefined && !connector;
    return {
      ...registration,
      ...(workspace ? { workspaceId: String(workspace.id) } : {}),
      lastUsedAt: connector?.lastUsedAt ?? null,
      ...(missing ? { connectorMissing: true, state: 'incomplete' } : {}),
    };
  });
}

function requestedTargets(input: Record<string, any>): string[] {
  if (input.credentialId !== undefined) return ['registration'];
  const list = Array.isArray(input.targets) ? input.targets : [input.target];
  return list.slice(0, 8).map(String);
}

export const handleAgentRoutes: AdminRouteHandler = async (req, res, url, context) => {
  if (url.pathname === '/api/agents/shutdown' && req.method === 'POST' && context.stopCore) {
    res.once('finish', () => setImmediate(() => context.stopCore?.()));
    sendAdminResponse(res, 200, { ok: true });
    return true;
  }
  const detect = url.pathname === '/api/agents/detect';
  if (url.pathname !== '/api/agents' && !detect) return false;
  if (!context.agents) {
    sendAdminResponse(res, 503, { error: { code: 'AGENT_INTEGRATION_UNAVAILABLE' } });
    return true;
  }
  if (detect) {
    if (req.method === 'GET')
      sendAdminResponse(res, 200, await context.agents({ operation: 'detect' }));
    else sendAdminResponse(res, 405, { error: { code: 'METHOD_NOT_ALLOWED' } });
    return true;
  }
  if (req.method === 'GET') {
    const status: any = await context.agents({
      operation: 'status',
      target: 'all',
      transport: 'stdio',
    });
    sendAdminResponse(res, 200, {
      ...status,
      registrations: decorate(context, status.registrations ?? []),
    });
  } else if (req.method === 'POST') {
    const input = await readAdminBody(req);
    if (!OPERATIONS.includes(String(input.operation)))
      return failure(res, 400, 'AGENT_OPTIONS_INVALID', 'unknown operation');
    // The scope is passed on as sent; core picks the default (user, or every scope for a
    // single `all` uninstall), so an explicit `user` never sweeps workspace registrations.
    const scope = input.scope;
    const byId = input.credentialId !== undefined;
    const sweep =
      input.operation === 'uninstall' && input.targets === undefined && input.target === 'all';
    const auditScope = byId ? 'registration' : (scope ?? (sweep ? 'all' : 'user'));
    const workspace = scope === 'workspace';
    if (byId) {
      if (input.operation !== 'uninstall' || typeof input.credentialId !== 'string')
        return failure(res, 400, 'AGENT_OPTIONS_INVALID', 'credentialId is only for uninstall');
      if (input.targets !== undefined || scope !== undefined || input.workspaceId !== undefined)
        return failure(
          res,
          400,
          'AGENT_OPTIONS_INVALID',
          'credentialId cannot be combined with targets, a scope or a workspace',
        );
    }
    const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId : undefined;
    let workspaceRoot: string | undefined;
    if (workspace) {
      if ((input.transport ?? 'stdio') !== 'stdio')
        return failure(
          res,
          400,
          'AGENT_OPTIONS_INVALID',
          'workspace scope requires the stdio transport',
        );
      const row = workspaceId ? context.workspaces?.getLocal?.(workspaceId) : undefined;
      const root = row?.hostRoot;
      if (typeof root !== 'string' || !root.trim())
        return failure(
          res,
          400,
          'AGENT_WORKSPACE_UNAVAILABLE',
          'The workspace is unknown or has no local folder',
        );
      workspaceRoot = root;
    }
    // The client never supplies a path: only the fields below reach the function. A credential
    // id is matched against the manifest by core, never used as a path.
    const request = byId
      ? {
          operation: input.operation,
          credentialId: input.credentialId,
          transport: input.transport,
          dryRun: input.dryRun,
        }
      : {
          operation: input.operation,
          ...(input.targets !== undefined ? { targets: input.targets } : { target: input.target }),
          transport: input.transport,
          dryRun: input.dryRun,
          ...(scope !== undefined ? { scope } : {}),
          workspaceRoot,
        };
    const audit = (target: string, ok: boolean) =>
      context.audit?.append?.({
        actor: 'admin',
        operation: `agent.${input.operation}`,
        target,
        scope: auditScope,
        ...(workspace ? { workspaceId } : {}),
        ...(input.dryRun === true ? { dryRun: true } : {}),
        result: ok ? 'ok' : 'error',
        redactionCount: 0,
        class: 'security',
      });
    let result: any;
    try {
      result = await context.agents(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('AGENT_OPTIONS_INVALID'))
        return failure(res, 400, 'AGENT_OPTIONS_INVALID', message);
      for (const target of requestedTargets(input)) audit(target, false);
      throw error;
    }
    for (const row of result.results ??
      requestedTargets(input).map((target) => ({ target, ok: true })))
      audit(String(row.target), row.ok !== false);
    sendAdminResponse(res, 200, {
      ...result,
      registrations: decorate(context, result.registrations ?? []),
    });
  } else sendAdminResponse(res, 405, { error: { code: 'METHOD_NOT_ALLOWED' } });
  return true;
};
