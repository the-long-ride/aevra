import type {
  ConnectorProfileEntry,
  ConnectorProfilesResponse,
} from '../../../../../packages/admin-contracts/src/token-usage.js';
import { advertisedGroupTokens } from '../../../../../packages/mcp-tools/src/registry-advertised.js';
import { TOOL_GROUPS } from '../../../../../packages/mcp-tools/src/tool-groups.js';
import { readAdminBody, sendAdminResponse } from './http.js';
import type { AdminApiContext, AdminRouteHandler } from './types.js';

const PREFIX = '/api/connector-profiles';
const KINDS = ['connector', 'oauth', 'client'] as const;

function describeActor(actor: string): Pick<ConnectorProfileEntry, 'label' | 'kind'> {
  const kind = KINDS.find((candidate) => actor.startsWith(`${candidate}:`));
  return kind ? { kind, label: actor.slice(kind.length + 1) } : { kind: 'other', label: actor };
}

/** Actors the admin can already see: bearer connectors, OAuth clients and live connections. */
function knownActors(context: AdminApiContext): Set<string> {
  const actors = new Set<string>();
  for (const connector of context.connectors?.list?.() ?? []) {
    if (connector?.name) actors.add(`connector:${connector.name}`);
  }
  for (const client of context.oauth?.listClients?.() ?? []) {
    const actor = client?.actor ?? (client?.clientName ? `oauth:${client.clientName}` : undefined);
    if (actor) actors.add(String(actor));
  }
  for (const connection of context.connections?.list?.() ?? []) {
    if (typeof connection?.actor === 'string' && connection.actor) actors.add(connection.actor);
  }
  return actors;
}

function fail(
  res: Parameters<AdminRouteHandler>[1],
  status: number,
  code: string,
  message: string,
): true {
  sendAdminResponse(res, status, { error: { code, message } });
  return true;
}

export const handleConnectorProfileRoutes: AdminRouteHandler = async (req, res, url, context) => {
  if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) return false;
  const profiles = context.connectorProfiles;
  if (!profiles) {
    return fail(res, 503, 'PROFILES_UNAVAILABLE', 'Connector profiles are not available.');
  }
  if (url.pathname === PREFIX) {
    if (req.method !== 'GET') return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Use GET.');
    const actors = knownActors(context);
    for (const actor of profiles.all().keys()) actors.add(actor);
    const entries: ConnectorProfileEntry[] = [...actors]
      .map((actor) => ({ actor, ...describeActor(actor), profile: profiles.get(actor) ?? {} }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const body: ConnectorProfilesResponse = {
      groups: [...TOOL_GROUPS],
      groupTokens: advertisedGroupTokens(),
      entries,
    };
    sendAdminResponse(res, 200, body);
    return true;
  }
  if (req.method !== 'PUT') return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Use PUT.');
  let actor: string;
  try {
    actor = decodeURIComponent(url.pathname.slice(PREFIX.length + 1));
  } catch {
    return fail(res, 400, 'INVALID_CONNECTOR_PROFILE', 'Invalid connector actor.');
  }
  // Errors from set() carry status 400 and a code; handleAdminApi maps them.
  const profile = profiles.set(actor, await readAdminBody(req));
  context.audit?.append?.({
    actor: 'admin',
    operation: 'connector.profile.update',
    target: actor,
    result: 'ok',
    redactionCount: 0,
    class: 'normal',
  });
  sendAdminResponse(res, 200, { actor, profile });
  return true;
};
