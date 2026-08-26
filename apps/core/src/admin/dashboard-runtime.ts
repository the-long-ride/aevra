import type { KeepAwakeStatus } from '../power/keep-awake-service.js';

export interface DashboardRuntimeSnapshot {
  generatedAt: string;
  startedAt: string;
  uptimeSeconds: number;
  status: any;
  metrics: any[];
  power: KeepAwakeStatus | null;
  pending: { approvals: number; oauth: number; total: number };
  stats: {
    sessions: number;
    workspaceLeases: number;
    processes: number;
    openChanges: number;
    toolCalls: number;
    avgToolLatencyMs: number | null;
    connectors: number;
  };
  activeConnections: any[];
  connectors: any[];
}

function authType(actor: string) {
  if (actor.startsWith('oauth:')) return 'OAuth';
  if (actor.startsWith('connector:')) return 'Bearer connector';
  return 'Access / remote identity';
}

function newestTimestamp(values: unknown[]) {
  let newest: string | undefined;
  for (const value of values) {
    if (!value) continue;
    const candidate = String(value);
    if (!newest || Date.parse(candidate) > Date.parse(newest)) newest = candidate;
  }
  return newest;
}

function buildConnectorInventory(context: any, sessions: any[]) {
  const oauthConnectors = (context.oauth?.listClients?.() ?? []).map((client: any) => {
    const name = String(client.clientName ?? client.clientId ?? 'OAuth client');
    const actor = String(client.actor ?? `oauth:${name}`);
    const matchingSessions = sessions.filter(
      (session: any) => String(session.actor ?? '') === actor,
    );
    return {
      id: String(client.clientId ?? actor),
      name,
      authType: 'OAuth',
      createdAt: client.createdAt,
      lastUsedAt: newestTimestamp(
        matchingSessions.map((session: any) => session.lastActivityAt ?? session.createdAt),
      ),
      revocable: false,
    };
  });
  const bearerConnectors = (context.connectors?.list?.() ?? []).map((connector: any) => ({
    id: String(connector.id),
    name: String(connector.name ?? connector.id),
    authType: 'Bearer connector',
    createdAt: connector.createdAt,
    lastUsedAt: connector.lastUsedAt,
    revocable: true,
  }));
  return [...oauthConnectors, ...bearerConnectors];
}

function sessionConnection(session: any, workspaceNames: Map<string, string>) {
  const leases = Array.isArray(session.leases)
    ? session.leases
    : session.lease
      ? [session.lease]
      : [];
  const workspaceIds = leases.map((lease: any) => String(lease?.workspaceId ?? '')).filter(Boolean);
  const workspaces = workspaceIds.map((id: string) => workspaceNames.get(id) ?? id);
  const capabilities = [...new Set(leases.flatMap((lease: any) => lease?.capabilities ?? []))];
  return {
    id: session.id,
    sessionId: session.id,
    actor: session.actor,
    client: String(session.actor ?? '').replace(/^(oauth:|connector:)/, ''),
    provider: authType(String(session.actor ?? '')),
    authType: authType(String(session.actor ?? '')),
    remoteIp: session.remoteIp ?? null,
    workspaceId: workspaceIds.length === 1 ? workspaceIds[0] : null,
    workspace: workspaces.join(', ') || null,
    workspaces,
    workspaceIds,
    capabilities,
    yolo: session.yolo === true,
    connectedAt: session.createdAt,
    lastActivityAt: session.lastActivityAt,
    status: 'CONNECTED',
  };
}

function connectionInventory(context: any, sessions: any[], workspaceNames: Map<string, string>) {
  const durable = context.connections?.list?.() ?? [];
  if (!durable.length) return sessions.map((session) => sessionConnection(session, workspaceNames));
  const durableIds = new Set(durable.map((row: any) => String(row.connectionId)));
  const oauth = durable.map((row: any) => {
    const workspaceIds = Array.isArray(row.workspaceIds) ? row.workspaceIds.map(String) : [];
    const workspaces = workspaceIds.map((id: string) => workspaceNames.get(id) ?? id);
    return {
      ...row,
      workspaceId: workspaceIds.length === 1 ? workspaceIds[0] : null,
      workspace: workspaces.join(', ') || null,
      workspaces,
    };
  });
  const otherSessions = sessions.filter(
    (session: any) =>
      !session.actor?.startsWith?.('oauth:') ||
      !durableIds.has(String(session.connectionId ?? session.subject)),
  );
  return [...oauth, ...otherSessions.map((session) => sessionConnection(session, workspaceNames))];
}

export function buildDashboardRuntimeSnapshot(
  context: any,
  status: any,
  startedAt: string,
  now = new Date(),
): DashboardRuntimeSnapshot {
  const metrics = context.metrics?.snapshot?.() ?? [];
  const approvals = (context.approvals?.list?.() ?? []).filter(
    (item: any) => item.state === 'PENDING',
  );
  const oauth = context.oauth?.listPendingAuthorizations?.() ?? [];
  const sessions = context.sessions?.list?.() ?? [];
  const processes = context.processes?.listLocal?.() ?? [];
  const changes = context.changes?.list?.() ?? [];
  const connectors = buildConnectorInventory(context, sessions);
  const workspaces = context.workspaces?.listRemote?.() ?? context.workspaces?.listLocal?.() ?? [];
  const workspaceNames = new Map<string, string>(
    workspaces.map((workspace: any) => [
      String(workspace.id),
      String(workspace.name ?? workspace.id),
    ]),
  );
  const toolCalls = metrics.reduce((sum: number, row: any) => sum + Number(row.calls || 0), 0),
    totalMs = metrics.reduce((sum: number, row: any) => sum + Number(row.totalMs || 0), 0);
  const activeConnections = connectionInventory(context, sessions, workspaceNames);
  return {
    generatedAt: now.toISOString(),
    startedAt,
    uptimeSeconds: Math.max(0, Math.floor((now.getTime() - Date.parse(startedAt)) / 1000)),
    status,
    metrics,
    power: context.power?.status?.() ?? null,
    pending: {
      approvals: approvals.length,
      oauth: oauth.length,
      total: approvals.length + oauth.length,
    },
    stats: {
      sessions: sessions.length,
      workspaceLeases: sessions.filter((row: any) => row.activeLeaseId || row.lease).length,
      processes: processes.filter((row: any) => row.ownership !== 'detached-uncertain').length,
      openChanges: changes.filter((row: any) => row.state === 'OPEN').length,
      toolCalls,
      avgToolLatencyMs: toolCalls ? Math.round(totalMs / toolCalls) : null,
      connectors: connectors.length,
    },
    activeConnections,
    connectors,
  };
}
