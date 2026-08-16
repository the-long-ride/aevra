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
    { version: '0.1.0', core: 'running', worker: 'running', mcp: 'running' },
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

test('dashboard snapshot covers empty legacy multi-workspace and fallback runtime shapes', () => {
  const empty = buildDashboardRuntimeSnapshot(
    {},
    { core: 'starting' },
    '2026-08-18T01:00:00Z',
    new Date('2026-08-18T00:00:00Z'),
  );
  assert.equal(empty.uptimeSeconds, 0);
  assert.deepEqual(empty.metrics, []);
  assert.deepEqual(empty.pending, { approvals: 0, oauth: 0, total: 0 });
  assert.deepEqual(empty.stats, {
    sessions: 0,
    workspaceLeases: 0,
    processes: 0,
    openChanges: 0,
    toolCalls: 0,
    avgToolLatencyMs: null,
    connectors: 0,
  });
  assert.deepEqual(empty.activeConnections, []);
  assert.deepEqual(empty.connectors, []);

  const context: any = {
    metrics: {
      snapshot: () => [
        { calls: 0, totalMs: 99 },
        { calls: 2, totalMs: 9 },
      ],
    },
    approvals: { list: () => [{ state: 'DENIED' }, { state: 'PENDING' }] },
    oauth: {
      listPendingAuthorizations: () => [],
      listClients: () => [
        { clientId: 'oauth-2', createdAt: '2026-08-17T00:00:00Z' },
        { clientName: 'Named only' },
        {},
      ],
    },
    connectors: { list: () => [{ id: 'bearer-1' }] },
    sessions: {
      list: () => [
        {
          id: 'multi',
          actor: 'oauth:oauth-2',
          leases: [
            { workspaceId: 'w1', capabilities: ['files.read', 'commands.run'] },
            { workspaceId: 'w2', capabilities: ['files.read'] },
            null,
          ],
          createdAt: '2026-08-17T01:00:00Z',
          lastActivityAt: null,
        },
        {
          id: 'legacy',
          actor: 'connector:bearer-1',
          lease: { workspaceId: 'missing-name', capabilities: [] },
          createdAt: '2026-08-17T02:00:00Z',
        },
        {
          id: 'remote',
          actor: 'access:user@example.com',
          leases: [],
          createdAt: '2026-08-17T03:00:00Z',
        },
      ],
    },
    processes: {
      listLocal: () => [
        { id: 'owned', ownership: 'owned' },
        { id: 'detached', ownership: 'detached-uncertain' },
      ],
    },
    changes: { list: () => [{ state: 'OPEN' }, { state: 'ROLLED_BACK' }] },
    workspaces: {
      listRemote: () => undefined,
      listLocal: () => [{ id: 'w1', name: 'One' }, { id: 'w2' }],
    },
  };
  const snapshot = buildDashboardRuntimeSnapshot(
    context,
    { core: 'running' },
    '2026-08-17T00:00:00Z',
    new Date('2026-08-17T04:00:00Z'),
  );
  assert.equal(snapshot.stats.toolCalls, 2);
  assert.equal(snapshot.stats.avgToolLatencyMs, 54);
  assert.equal(snapshot.stats.workspaceLeases, 1);
  assert.equal(snapshot.stats.processes, 1);
  assert.equal(snapshot.activeConnections[0].workspaceId, null);
  assert.equal(snapshot.activeConnections[0].workspace, 'One, w2');
  assert.deepEqual(snapshot.activeConnections[0].capabilities.sort(), [
    'commands.run',
    'files.read',
  ]);
  assert.equal(snapshot.activeConnections[0].remoteIp, null);
  assert.equal(snapshot.activeConnections[0].yolo, false);
  assert.equal(snapshot.activeConnections[1].workspace, 'missing-name');
  assert.equal(snapshot.activeConnections[2].provider, 'Access / remote identity');
  assert.equal(snapshot.activeConnections[2].workspace, null);
  assert.equal(snapshot.connectors[0].name, 'oauth-2');
  assert.equal(snapshot.connectors[0].lastUsedAt, '2026-08-17T01:00:00Z');
  assert.equal(snapshot.connectors[1].name, 'Named only');
  assert.match(snapshot.connectors[1].id, /^oauth:/);
  assert.equal(snapshot.connectors[2].name, 'OAuth client');
  assert.equal(snapshot.connectors.at(-1)?.name, 'bearer-1');
});
