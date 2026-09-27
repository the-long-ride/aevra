import assert from 'node:assert/strict';
import test from 'node:test';
import { ConnectionAdminService } from '../src/admin/connection-admin.js';

const NOW = new Date('2026-06-01T00:00:00.000Z');

function oauthRepo(connections: Record<string, any> = {}, extra: Record<string, any> = {}) {
  const calls: string[] = [];
  return {
    calls,
    getConnection: (id: string) => connections[id] ?? null,
    listConnections: () => Object.values(connections),
    getLatestRefreshFamily: () => null,
    revokeConnection: (id: string, reason: string) => calls.push(`revoke:${id}:${reason}`),
    clearRememberedWorkspaceGrants: (id: string) => calls.push(`clear:${id}`),
    ...extra,
  } as any;
}

function controlAccess(grants: any[] = []) {
  const calls: unknown[][] = [];
  return {
    calls,
    list: () => grants,
    grant: (identity: unknown, capability: string, actor: string) => (
      calls.push(['grant', identity, capability, actor]),
      { ok: true }
    ),
    revoke: async (identity: unknown, capability: string) => (
      calls.push(['revoke', identity, capability]),
      true
    ),
  } as any;
}

function service(
  repo: any,
  sessions: any[] = [],
  grantHandler?: any,
  onRevoke?: (id: string) => void,
) {
  return new ConnectionAdminService(
    repo,
    { list: () => sessions },
    3600,
    () => NOW,
    grantHandler,
    onRevoke,
  );
}

const active = {
  subject: 'conn-1',
  actor: 'oauth:Claude',
  status: 'ACTIVE',
  lastUsedAt: '2026-05-01T00:00:00.000Z',
};

test('control listing requires a known connection and ignores revoked grants', () => {
  const admin = service(oauthRepo({ 'conn-1': active }));
  assert.throws(
    () => admin.listControl('missing'),
    (error: any) => error.code === 'NOT_FOUND',
  );
  assert.deepEqual(admin.listControl('conn-1'), {
    connectionId: 'conn-1',
    browser: false,
    desktop: false,
  });
  admin.setControlAccess(
    controlAccess([
      { capability: 'browser.control' },
      { capability: 'desktop.control', revokedAt: '2026-05-02T00:00:00.000Z' },
    ]),
  );
  assert.deepEqual(admin.listControl('conn-1'), {
    connectionId: 'conn-1',
    browser: true,
    desktop: false,
  });
});

test('control grants require an active connection and configured access', async () => {
  const admin = service(
    oauthRepo({ 'conn-1': active, 'conn-2': { ...active, subject: 'conn-2', status: 'REVOKED' } }),
  );
  assert.throws(
    () => admin.grantControl('missing', 'browser.control'),
    /Active connection not found/,
  );
  assert.throws(
    () => admin.grantControl('conn-2', 'browser.control'),
    /Active connection not found/,
  );
  assert.throws(() => admin.grantControl('conn-1', 'browser.control'), /not configured/);
  await assert.rejects(
    () => admin.revokeControl('missing', 'desktop.control'),
    /Connection not found/,
  );
  assert.equal(await admin.revokeControl('conn-1', 'desktop.control'), false);
  const access = controlAccess();
  admin.setControlAccess(access);
  assert.deepEqual(admin.grantControl('conn-1', 'desktop.control'), { ok: true });
  assert.equal(await admin.revokeControl('conn-1', 'desktop.control'), true);
  assert.deepEqual(access.calls, [
    ['grant', { kind: 'oauth', key: 'conn-1' }, 'desktop.control', 'admin'],
    ['revoke', { kind: 'oauth', key: 'conn-1' }, 'desktop.control'],
  ]);
});

test('workspace grants need a handler and accept boolean or object removal results', () => {
  const admin = service(oauthRepo());
  assert.throws(() => admin.grantWorkspace('c', 'w'), /handler not configured/);
  assert.equal(admin.revokeWorkspace('c', 'w'), false);
  const granted: any[] = [];
  let removal: any = true;
  admin.setGrantHandler({
    grant: (input) => granted.push(input),
    remove: () => removal,
    list: () => [],
  });
  admin.grantWorkspace('c', 'w');
  assert.deepEqual(granted, [{ connectionId: 'c', workspaceId: 'w', profileId: 'read-only' }]);
  assert.equal(admin.revokeWorkspace('c', 'w'), true);
  removal = { removed: false };
  assert.equal(admin.revokeWorkspace('c', 'w'), false);
  removal = undefined;
  assert.equal(admin.revokeWorkspace('c', 'w'), false);
});

test('list projects offline, grace and revoked states without sessions', () => {
  const repo = oauthRepo({
    a: { ...active, subject: 'a' },
    b: { ...active, subject: 'b', graceExpiresAt: '2026-06-02T00:00:00.000Z' },
    c: { ...active, subject: 'c', graceExpiresAt: '2026-05-01T00:00:00.000Z' },
    d: { ...active, subject: 'd', status: 'REVOKED', yoloEnabled: 1 },
  });
  const rows = service(repo).list();
  assert.deepEqual(
    rows.map((row) => [row.id, row.status]),
    [
      ['a', 'OFFLINE'],
      ['b', 'GRACE'],
      ['c', 'OFFLINE'],
      ['d', 'REVOKED'],
    ],
  );
  const offline = rows[0]!;
  assert.equal(offline.lastActivityAt, active.lastUsedAt);
  assert.equal(offline.remoteIp, null);
  assert.equal(offline.renewable, false);
  assert.equal('sessionId' in offline, false);
  assert.equal('refreshFamilyExpiresAt' in offline, false);
  assert.equal(rows[1]!.graceExpiresAt, '2026-06-02T00:00:00.000Z');
  assert.equal(rows[3]!.yolo, true);
});

test('list merges matching sessions, leases, origins, grants and refresh family', () => {
  const repo = oauthRepo(
    { 'conn-1': active },
    {
      listConnectionOrigins: () => [{ remoteIp: '10.0.0.9', lastSeenAt: 'x' }],
      getLatestRefreshFamily: () => ({ status: 'ACTIVE', expiresAt: '2026-07-01T00:00:00.000Z' }),
    },
  );
  const sessions = [
    {
      id: 's1',
      connectionId: 'conn-1',
      createdAt: '2026-05-10T00:00:00.000Z',
      leases: [{ workspaceId: 'w1', capabilities: ['files.read'] }, null],
    },
    {
      id: 's2',
      actor: 'oauth:Claude',
      subject: 'conn-1',
      lastActivityAt: '2026-05-20T00:00:00.000Z',
      lease: { workspaceId: 'w2', capabilities: ['files.read', 'git.read'] },
    },
    { id: 's3', actor: 'oauth:Claude', subject: 'other' },
    { id: 's4', connectionId: 'conn-1' },
  ];
  const grants = {
    grant: () => undefined,
    remove: () => true,
    list: () => [
      { workspaceId: 'w3', profileId: 'developer' },
      { workspaceId: 'w1', profileId: 'x' },
    ],
  };
  const [row] = service(repo, sessions, grants).list();
  assert.equal(row!.status, 'CONNECTED');
  assert.equal(row!.sessionCount, 3);
  assert.equal(row!.sessionId, 's1');
  assert.equal(row!.connectedAt, '2026-05-10T00:00:00.000Z');
  assert.equal(row!.lastActivityAt, '2026-05-20T00:00:00.000Z');
  assert.deepEqual(row!.workspaceIds, ['w1', 'w2', 'w3']);
  assert.deepEqual(row!.capabilities, ['files.read', 'git.read']);
  assert.equal(row!.remoteIp, '10.0.0.9');
  assert.equal(row!.renewable, true);
  assert.equal(row!.refreshFamilyExpiresAt, '2026-07-01T00:00:00.000Z');
  assert.equal(row!.client, 'Claude');
});

test('list falls back to the primary session address and flags expired families', () => {
  const repo = oauthRepo(
    { 'conn-1': active },
    { getLatestRefreshFamily: () => ({ status: 'ACTIVE', expiresAt: '2026-01-01T00:00:00.000Z' }) },
  );
  const [row] = service(repo, [{ id: 7, connectionId: 'conn-1', remoteIp: '10.0.0.5' }]).list();
  assert.equal(row!.remoteIp, '10.0.0.5');
  assert.equal(row!.sessionId, '7');
  assert.equal(row!.renewable, false);
  const spent = oauthRepo(
    { 'conn-1': active },
    { getLatestRefreshFamily: () => ({ status: 'SPENT', expiresAt: '2027-01-01T00:00:00.000Z' }) },
  );
  assert.equal(service(spent).list()[0]!.renewable, false);
});

test('revoke tears down sessions, the connection and remembered grants', () => {
  const repo = oauthRepo({ 'conn-1': active });
  const revokedSessions: string[] = [];
  const notified: string[] = [];
  const admin = new ConnectionAdminService(
    repo,
    { list: () => [], revokeConnection: (id, reason) => revokedSessions.push(`${id}:${reason}`) },
    60,
    undefined,
    undefined,
    (id) => notified.push(id),
  );
  assert.equal(admin.revoke('missing'), false);
  assert.equal(admin.revoke('conn-1'), true);
  assert.deepEqual(revokedSessions, ['conn-1:ADMIN_REVOKE']);
  assert.deepEqual(repo.calls, ['revoke:conn-1:ADMIN_REVOKE', 'clear:conn-1']);
  assert.deepEqual(notified, ['conn-1']);
  const quiet = service(oauthRepo({ 'conn-1': active }));
  assert.equal(quiet.revoke('conn-1'), true);
});
