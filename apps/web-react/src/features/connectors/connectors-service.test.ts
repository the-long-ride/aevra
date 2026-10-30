import { describe, expect, test, vi } from 'vitest';
import * as apiClient from '../../services/api-client';
import {
  buildUnifiedConnectors,
  removeConnectorItem,
  type ConnectorItem,
  type RawConnectorRecord,
} from './connectors-service';
import type { DashboardData } from '../dashboard/dashboard-service';

describe('connectors-service', () => {
  const mockDashboard: DashboardData = {
    workspaces: [
      {
        id: 'ws-1',
        name: 'Workspace Alpha',
        hostRoot: '/alpha',
        defaultAccess: 'read',
        allowLocalTokens: false,
        allowRemoteSessions: true,
        allowAdminLeases: true,
      },
    ],
    snapshot: {
      activeConnections: [
        {
          id: 'ses-active-1',
          sessionId: 'ses-active-1',
          client: 'Claude Code',
          actor: 'connector:Claude Code',
          authType: 'Bearer connector',
          yolo: true,
          workspaces: ['Workspace Alpha'],
          workspaceIds: ['ws-1'],
          capabilities: ['files.read'],
        },
      ],
      connectors: [
        {
          id: 'snap-1',
          name: 'Snapshot Client',
          authType: 'OAuth',
          revocable: true,
        },
      ],
    } as any,
  } as unknown as DashboardData;

  const rawConnectors: RawConnectorRecord[] = [
    {
      id: 'conn-bearer-1',
      name: 'Claude Code',
      createdAt: '2026-01-01T00:00:00Z',
      lastUsedAt: '2026-01-02T00:00:00Z',
      workspaceId: 'ws-1',
      profileCap: 'files.read',
      expiresAt: null,
    },
    {
      id: 'conn-bearer-disconnected',
      name: 'Offline Client',
      createdAt: '2026-01-01T00:00:00Z',
      lastUsedAt: null,
      workspaceId: 'ws-1',
      profileCap: null,
      expiresAt: null,
    },
  ];

  const durableConnections: Array<Record<string, unknown>> = [
    {
      id: 'oauth-durable-1',
      connectionId: 'oauth-durable-1',
      client: 'ChatGPT OAuth',
      actor: 'oauth:ChatGPT',
      status: 'IDLE',
      yolo: false,
      workspaceIds: ['ws-1'],
      capabilities: ['files.read', 'files.write'],
    },
    {
      id: 'oauth-revoked',
      connectionId: 'oauth-revoked',
      status: 'REVOKED',
    },
  ];

  test('buildUnifiedConnectors merges bearer, active, durable, and snapshot records', () => {
    const unified = buildUnifiedConnectors(mockDashboard, rawConnectors, durableConnections);

    // 1. Claude Code matched active connection
    const claude = unified.find((c) => c.name === 'Claude Code');
    expect(claude).toBeDefined();
    expect(claude?.status).toBe('CONNECTED');
    expect(claude?.yolo).toBe(true);
    expect(claude?.authType).toBe('Bearer connector');
    expect(claude?.connectorId).toBe('conn-bearer-1');

    // 2. Offline Client is DISCONNECTED
    const offline = unified.find((c) => c.name === 'Offline Client');
    expect(offline).toBeDefined();
    expect(offline?.status).toBe('DISCONNECTED');
    expect(offline?.workspace).toBe('Workspace Alpha');

    // 3. Durable OAuth is included and REVOKED is filtered out
    const oauth = unified.find((c) => c.id === 'oauth-durable-1');
    expect(oauth).toBeDefined();
    expect(oauth?.authType).toBe('OAuth');
    expect(oauth?.status).toBe('DISCONNECTED');
    expect(unified.some((c) => c.id === 'oauth-revoked')).toBe(false);

    // 4. Snapshot connector is included
    const snap = unified.find((c) => c.id === 'snap-1');
    expect(snap).toBeDefined();
    expect(snap?.status).toBe('DISCONNECTED');
  });

  test('removeConnectorItem handles bearer connector deletion', async () => {
    const spy = vi.spyOn(apiClient, 'requestJson').mockResolvedValue({});
    const item: ConnectorItem = {
      id: 'conn-1',
      connectorId: 'conn-1',
      name: 'Test',
      client: 'Test',
      authType: 'Bearer connector',
      status: 'DISCONNECTED',
      yolo: false,
      workspace: null,
      workspaces: [],
      workspaceIds: [],
      capabilities: [],
      revocable: true,
    };

    await removeConnectorItem(item);
    expect(spy).toHaveBeenCalledWith('/api/connectors/conn-1', { method: 'DELETE' });
    spy.mockRestore();
  });

  test('removeConnectorItem cascades session revocation and ignores dropped session errors if connector succeeded', async () => {
    const spy = vi.spyOn(apiClient, 'requestJson').mockImplementation(async (url) => {
      if (url.includes('/api/connectors/')) return {};
      if (url.includes('/api/sessions/')) throw new Error('Session not found (already dropped)');
      return {};
    });

    const item: ConnectorItem = {
      id: 'conn-1',
      connectorId: 'conn-1',
      sessionId: 'ses-1',
      name: 'Test',
      client: 'Test',
      authType: 'Bearer connector',
      status: 'CONNECTED',
      yolo: false,
      workspace: null,
      workspaces: [],
      workspaceIds: [],
      capabilities: [],
      revocable: true,
    };

    // Should resolve without error because connector deletion succeeded
    await expect(removeConnectorItem(item)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith('/api/connectors/conn-1', { method: 'DELETE' });
    expect(spy).toHaveBeenCalledWith('/api/sessions/ses-1/revoke', { method: 'POST', body: '{}' });
    spy.mockRestore();
  });

  test('removeConnectorItem throws if all deletion attempts fail', async () => {
    const spy = vi.spyOn(apiClient, 'requestJson').mockRejectedValue(new Error('Network failure'));
    const item: ConnectorItem = {
      id: 'conn-fail',
      connectorId: 'conn-fail',
      name: 'Test',
      client: 'Test',
      authType: 'Bearer connector',
      status: 'DISCONNECTED',
      yolo: false,
      workspace: null,
      workspaces: [],
      workspaceIds: [],
      capabilities: [],
      revocable: true,
    };

    await expect(removeConnectorItem(item)).rejects.toThrow('Network failure');
    spy.mockRestore();
  });

  test('removeConnectorItem handles OAuth client deletion and groups duplicate registrations', async () => {
    const spy = vi.spyOn(apiClient, 'requestJson').mockResolvedValue({});
    const item: ConnectorItem = {
      id: 'oauth-client-1',
      clientId: 'oauth-client-1',
      clientIds: ['oauth-client-1', 'oauth-client-2'],
      name: 'Claude Code (aevra)',
      client: 'Claude Code (aevra)',
      authType: 'OAuth',
      status: 'DISCONNECTED',
      yolo: false,
      workspace: null,
      workspaces: [],
      workspaceIds: [],
      capabilities: [],
      revocable: true,
    };

    await removeConnectorItem(item);
    expect(spy).toHaveBeenCalledWith('/api/oauth/clients/oauth-client-1?force=true', {
      method: 'DELETE',
    });
    expect(spy).toHaveBeenCalledWith('/api/oauth/clients/oauth-client-2?force=true', {
      method: 'DELETE',
    });
    spy.mockRestore();
  });
});
