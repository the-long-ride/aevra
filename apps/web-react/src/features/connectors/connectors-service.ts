import type { WorkspaceSummary } from '@aevra/admin-contracts';
import { requestJson } from '../../services/api-client';
import { loadDashboard, type DashboardData } from '../dashboard/dashboard-service';
import type { ActiveConnection } from '../dashboard/ConnectionDetailModal';

export interface RawConnectorRecord {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  workspaceId: string | null;
  workspaceIds?: string[];
  workspaceGrants?: Array<{ workspaceId: string; profileId: string }>;
  profileCap: string | null;
  expiresAt: string | null;
}

export interface ConnectorItem extends ActiveConnection {
  id: string;
  connectorId?: string;
  connectionId?: string;
  sessionId?: string;
  clientId?: string;
  clientIds?: string[];
  name: string;
  client: string;
  actor?: string;
  authType: 'OAuth' | 'Bearer connector';
  status: 'CONNECTED' | 'DISCONNECTED';
  yolo: boolean;
  workspace: string | null;
  workspaces: string[];
  workspaceIds: string[];
  capabilities: string[];
  lastActivityAt?: string;
  connectedAt?: string;
  remoteIp?: string | null;
  revocable: boolean;
}

export interface ConnectorsData {
  connectors: ConnectorItem[];
  workspaces: WorkspaceSummary[];
}

export function buildUnifiedConnectors(
  dashboard: DashboardData,
  rawConnectors: RawConnectorRecord[],
  durableConnections: Array<Record<string, unknown>>,
): ConnectorItem[] {
  const activeConnections = dashboard.snapshot.activeConnections ?? [];
  const workspaceMap = new Map<string, string>(dashboard.workspaces.map((ws) => [ws.id, ws.name]));

  const items: ConnectorItem[] = [];
  const matchedActiveIds = new Set<string>();
  const matchedConnectionIds = new Set<string>();

  // 1. Bearer connectors
  for (const bearer of rawConnectors) {
    const active = activeConnections.find(
      (conn: any) =>
        conn.actor === `connector:${bearer.name}` ||
        conn.actor === bearer.name ||
        conn.client === bearer.name ||
        conn.id === bearer.id,
    ) as Record<string, any> | undefined;

    const wsIds =
      Array.isArray(bearer.workspaceIds) && bearer.workspaceIds.length
        ? bearer.workspaceIds
        : bearer.workspaceId
          ? [bearer.workspaceId]
          : Array.isArray(active?.workspaceIds)
            ? active.workspaceIds.map(String)
            : [];
    const wsNames = wsIds.map((id) => workspaceMap.get(id) ?? id);
    const grants =
      bearer.workspaceGrants ??
      wsIds.map((id) => ({
        workspaceId: id,
        profileId: bearer.profileCap ?? 'read-only',
      }));

    const wsDisplay =
      wsNames.join(', ') || (typeof active?.workspace === 'string' ? active.workspace : null);
    const activeCaps = Array.isArray(active?.capabilities) ? active.capabilities.map(String) : [];
    const caps = active ? activeCaps : bearer.profileCap ? [bearer.profileCap] : [];
    const lastActive =
      typeof active?.lastActivityAt === 'string'
        ? active.lastActivityAt
        : (bearer.lastUsedAt ?? undefined);
    const connected =
      typeof active?.connectedAt === 'string' ? active.connectedAt : bearer.createdAt;

    if (active) {
      matchedActiveIds.add(String(active.id ?? active.sessionId ?? ''));
    }

    items.push({
      ...(active ?? {}),
      id: bearer.id,
      connectorId: bearer.id,
      sessionId:
        typeof active?.sessionId === 'string'
          ? active.sessionId
          : typeof active?.id === 'string'
            ? active.id
            : undefined,
      name: bearer.name,
      client: bearer.name,
      actor: typeof active?.actor === 'string' ? active.actor : `connector:${bearer.name}`,
      authType: 'Bearer connector',
      status: active ? 'CONNECTED' : 'DISCONNECTED',
      yolo: Boolean(active?.yolo),
      workspace: wsDisplay,
      workspaces: wsNames.length
        ? wsNames
        : Array.isArray(active?.workspaces)
          ? active.workspaces.map(String)
          : [],
      workspaceIds: wsIds,
      workspaceGrants: grants,
      capabilities: caps,
      lastActivityAt: lastActive,
      connectedAt: connected,
      remoteIp: typeof active?.remoteIp === 'string' ? active.remoteIp : null,
      revocable: true,
    });
  }

  // 2. Active connections not already matched to a bearer connector
  for (const active of activeConnections) {
    const activeObj = active as Record<string, any>;
    const activeId = String(activeObj.id ?? activeObj.sessionId ?? '');
    if (matchedActiveIds.has(activeId)) continue;

    const isOAuth =
      activeObj.authType === 'OAuth' || String(activeObj.actor ?? '').startsWith('oauth:');
    const authType: 'OAuth' | 'Bearer connector' = isOAuth ? 'OAuth' : 'Bearer connector';
    const connId =
      typeof activeObj.connectionId === 'string'
        ? activeObj.connectionId
        : isOAuth
          ? activeId
          : undefined;
    if (connId) matchedConnectionIds.add(connId);

    const activeClientId = typeof activeObj.clientId === 'string' ? activeObj.clientId : undefined;
    items.push({
      ...activeObj,
      id: activeId,
      clientId: activeClientId,
      clientIds: activeClientId ? [activeClientId] : undefined,
      connectionId: connId,
      sessionId: typeof activeObj.sessionId === 'string' ? activeObj.sessionId : activeId,
      name: String(activeObj.client ?? activeObj.actor ?? activeId),
      client: String(activeObj.client ?? activeObj.actor ?? activeId),
      actor: typeof activeObj.actor === 'string' ? activeObj.actor : undefined,
      authType,
      status: 'CONNECTED',
      yolo: Boolean(activeObj.yolo),
      workspace: typeof activeObj.workspace === 'string' ? activeObj.workspace : null,
      workspaces: Array.isArray(activeObj.workspaces) ? activeObj.workspaces.map(String) : [],
      workspaceIds: Array.isArray(activeObj.workspaceIds) ? activeObj.workspaceIds.map(String) : [],
      capabilities: Array.isArray(activeObj.capabilities) ? activeObj.capabilities.map(String) : [],
      lastActivityAt:
        typeof activeObj.lastActivityAt === 'string' ? activeObj.lastActivityAt : undefined,
      connectedAt: typeof activeObj.connectedAt === 'string' ? activeObj.connectedAt : undefined,
      remoteIp: typeof activeObj.remoteIp === 'string' ? activeObj.remoteIp : null,
      revocable: true,
    });
  }

  // 3. Durable OAuth connections that might be idle/disconnected
  for (const durable of durableConnections) {
    const connId = String(durable.connectionId ?? durable.id ?? '');
    if (!connId || matchedConnectionIds.has(connId)) continue;
    if (durable.status === 'REVOKED') continue;

    const wsIds = Array.isArray(durable.workspaceIds) ? durable.workspaceIds.map(String) : [];
    const wsNames = wsIds.map((id) => workspaceMap.get(id) ?? id);
    const durableClientId =
      typeof durable.clientId === 'string' ? String(durable.clientId) : undefined;

    items.push({
      ...(durable as any),
      id: connId,
      connectionId: connId,
      clientId: durableClientId,
      clientIds: durableClientId ? [durableClientId] : undefined,
      name: String(durable.client ?? durable.actor ?? connId),
      client: String(durable.client ?? durable.actor ?? connId),
      actor: typeof durable.actor === 'string' ? durable.actor : undefined,
      authType: 'OAuth',
      status: 'DISCONNECTED',
      yolo: Boolean(durable.yolo),
      workspace: wsNames.join(', ') || null,
      workspaces: wsNames,
      workspaceIds: wsIds,
      capabilities: Array.isArray(durable.capabilities) ? durable.capabilities.map(String) : [],
      lastActivityAt:
        typeof durable.lastActivityAt === 'string' ? durable.lastActivityAt : undefined,
      connectedAt: typeof durable.connectedAt === 'string' ? durable.connectedAt : undefined,
      remoteIp: typeof durable.remoteIp === 'string' ? durable.remoteIp : null,
      revocable: true,
    });
  }

  // 4. Any connector inventory from dashboard snapshot not covered yet
  const snapshotConnectors = dashboard.snapshot.connectors ?? [];
  for (const snap of snapshotConnectors) {
    const snapObj = snap as Record<string, any>;
    const snapName = String(snapObj.name ?? snapObj.id ?? '');
    const snapClientId =
      typeof snapObj.clientId === 'string'
        ? snapObj.clientId
        : snapObj.authType === 'OAuth'
          ? String(snapObj.id)
          : undefined;
    const snapActor = typeof snapObj.actor === 'string' ? snapObj.actor : undefined;

    const existing = items.find(
      (item) =>
        item.id === snapObj.id ||
        item.name === snapName ||
        (snapClientId && item.clientId === snapClientId) ||
        (snapActor && item.actor === snapActor),
    );

    if (existing) {
      if (snapClientId) {
        if (!existing.clientIds) existing.clientIds = existing.clientId ? [existing.clientId] : [];
        if (!existing.clientIds.includes(snapClientId)) existing.clientIds.push(snapClientId);
      }
      continue;
    }

    items.push({
      id: String(snapObj.id),
      clientId: snapClientId,
      clientIds: snapClientId ? [snapClientId] : undefined,
      name: snapName,
      client: snapName,
      actor: snapActor,
      authType: snapObj.authType === 'OAuth' ? 'OAuth' : 'Bearer connector',
      status: 'DISCONNECTED',
      yolo: false,
      workspace: null,
      workspaces: [],
      workspaceIds: [],
      capabilities: [],
      lastActivityAt: typeof snapObj.lastUsedAt === 'string' ? snapObj.lastUsedAt : undefined,
      connectedAt: typeof snapObj.createdAt === 'string' ? snapObj.createdAt : undefined,
      remoteIp: null,
      revocable: snapObj.revocable !== false,
    });
  }

  return items;
}

export async function loadConnectorsData(signal?: AbortSignal): Promise<ConnectorsData> {
  const options = signal ? { signal } : {};
  const [dashboard, rawConnectors, durableConnections] = await Promise.all([
    loadDashboard(signal),
    requestJson<RawConnectorRecord[]>('/api/connectors', options).catch(() => []),
    requestJson<Array<Record<string, unknown>>>('/api/connections', options).catch(() => []),
  ]);

  return {
    connectors: buildUnifiedConnectors(dashboard, rawConnectors, durableConnections),
    workspaces: dashboard.workspaces,
  };
}

export async function removeConnectorItem(item: ConnectorItem): Promise<void> {
  const errors: unknown[] = [];
  let attempted = 0;
  let succeeded = 0;

  const tryCall = async (url: string, init?: RequestInit, bestEffort = false) => {
    attempted++;
    try {
      await requestJson(url, init);
      succeeded++;
    } catch (err) {
      if (!bestEffort || succeeded === 0) {
        errors.push(err);
      }
    }
  };

  if (item.connectorId) {
    await tryCall(`/api/connectors/${encodeURIComponent(item.connectorId)}`, { method: 'DELETE' });
  }
  if (item.connectionId) {
    await tryCall(`/api/connections/${encodeURIComponent(item.connectionId)}/revoke`, {
      method: 'POST',
      body: '{}',
    });
  }
  if (item.sessionId) {
    await tryCall(
      `/api/sessions/${encodeURIComponent(item.sessionId)}/revoke`,
      { method: 'POST', body: '{}' },
      true,
    );
  }

  const clientIds = item.clientIds?.length
    ? item.clientIds
    : item.clientId
      ? [item.clientId]
      : item.authType === 'OAuth' && !item.connectionId && !item.connectorId
        ? [item.id]
        : [];
  for (const cId of clientIds) {
    await tryCall(
      `/api/oauth/clients/${encodeURIComponent(cId)}?force=true`,
      { method: 'DELETE' },
      true,
    );
  }

  if (attempted === 0) {
    await tryCall(`/api/connectors/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
  }

  if (succeeded === 0 && errors.length > 0) {
    throw errors[0];
  }
}
