import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDashboardRuntimeSnapshot } from '../src/admin/dashboard-runtime.js';

test('dashboard snapshot aggregates runtime state and active connections', () => {
  const context: any = {
    metrics: { snapshot: () => [{ tool: 'file_read', calls: 4, totalMs: 20, avgMs: 5 }] },
    approvals: { list: () => [{ state: 'PENDING' }, { state: 'SUCCEEDED' }] },
    oauth: {
      listPendingAuthorizations: () => [{ id: 'oauth_1' }],
      listClients: () => [
        {
          clientId: 'oauth-client-1',
          clientName: 'ChatGPT',
          actor: 'oauth:ChatGPT',
          createdAt: '2026-08-17T12:00:00Z',
        },
      ],
    },
    sessions: {
      list: () => [
        {
          id: 's1',
          actor: 'oauth:ChatGPT',
          subject: 'grant-a',
          yolo: true,
          createdAt: '2026-08-18T00:00:00Z',
          lastActivityAt: '2026-08-18T00:01:00Z',
          remoteIp: '1.2.3.4',
          activeLeaseId: 'l1',
          lease: { workspaceId: 'w1', capabilities: ['files.read'] },
        },
        {
          id: 's2',
          actor: 'connector:CLI',
          subject: 'conn-1',
          createdAt: '2026-08-18T00:02:00Z',
          lastActivityAt: '2026-08-18T00:03:00Z',
        },
      ],
    },
    processes: { listLocal: () => [{ id: 'p1', ownership: 'owned' }] },
    changes: {
      list: () => [
        { id: 'c1', state: 'OPEN' },
        { id: 'c2', state: 'COMMITTED' },
      ],
    },
    connectors: {
      list: () => [
        {
          id: 'conn-1',
          name: 'CLI',
          createdAt: '2026-08-17T00:00:00Z',
          lastUsedAt: '2026-08-18T00:03:00Z',
        },
      ],
    },
    workspaces: { listRemote: () => [{ id: 'w1', name: 'Aevra' }] },
  };
  const snapshot = buildDashboardRuntimeSnapshot(
    context,
    { version: '0.5.0', core: 'running', worker: 'running', mcp: 'running' },
    '2026-08-18T00:00:00Z',
    new Date('2026-08-18T00:10:00Z'),
  );
  assert.equal(snapshot.stats.toolCalls, 4);
  assert.equal(snapshot.pending.total, 2);
  assert.equal(snapshot.stats.sessions, 2);
  assert.equal(snapshot.stats.workspaceLeases, 1);
  assert.equal(snapshot.stats.processes, 1);
  assert.equal(snapshot.stats.openChanges, 1);
  assert.equal(snapshot.stats.connectors, 2);
  assert.equal(snapshot.uptimeSeconds, 600);
  assert.equal(snapshot.activeConnections[0].authType, 'OAuth');
  assert.equal(snapshot.activeConnections[0].provider, 'OAuth');
  assert.equal(snapshot.activeConnections[0].workspace, 'Aevra');
  assert.deepEqual(snapshot.activeConnections[0].workspaces, ['Aevra']);
  assert.equal(snapshot.activeConnections[0].yolo, true);
  assert.equal(snapshot.activeConnections[1].authType, 'Bearer connector');
  assert.deepEqual(snapshot.connectors, [
    {
      id: 'oauth-client-1',
      name: 'ChatGPT',
      authType: 'OAuth',
      createdAt: '2026-08-17T12:00:00Z',
      lastUsedAt: '2026-08-18T00:01:00Z',
      revocable: false,
    },
    {
      id: 'conn-1',
      name: 'CLI',
      createdAt: '2026-08-17T00:00:00Z',
      lastUsedAt: '2026-08-18T00:03:00Z',
      authType: 'Bearer connector',
      revocable: true,
    },
  ]);
});
