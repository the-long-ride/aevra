import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { ConnectionAdminService } from '../src/admin/connection-admin.js';
import { handleConnectionRoutes } from '../src/admin/routes/connection-routes.js';

function request(method: string) {
  const stream = Readable.from([]) as any;
  stream.method = method;
  stream.headers = {};
  return stream;
}

function response() {
  const result = {
    statusCode: 0,
    body: '',
    setHeader() {},
    end(value = '') {
      result.body = String(value);
    },
  };
  return result as any;
}

async function call(pathname: string, method: string, context: any) {
  const res = response();
  const handled = await handleConnectionRoutes(
    request(method),
    res,
    new URL(`https://localhost${pathname}`),
    context,
  );
  return {
    handled,
    status: res.statusCode,
    value: res.body ? JSON.parse(res.body) : undefined,
  };
}

test('connection admin projection exposes continuity state without credential material', () => {
  const oauth = {
    listConnections: () => [
      {
        subject: 'oauth_grant_1',
        actor: 'oauth:ChatGPT',
        status: 'ACTIVE',
        yoloEnabled: true,
        lastUsedAt: '2026-08-26T00:00:00.000Z',
        graceExpiresAt: '2099-01-01T00:00:00.000Z',
      },
    ],
    getLatestRefreshFamily: () => ({ expiresAt: '2099-02-01T00:00:00.000Z' }),
  } as any;
  const sessions = {
    list: () => [
      {
        id: 'ses_1',
        actor: 'oauth:ChatGPT',
        subject: 'oauth_grant_1',
        connectionId: 'oauth_grant_1',
      },
    ],
  } as any;
  const service = new ConnectionAdminService(oauth, sessions, 3600);
  const [row] = service.list();

  assert.equal(row.connectionId, 'oauth_grant_1');
  assert.equal(row.status, 'CONNECTED');
  assert.equal(row.sessionCount, 1);
  assert.equal(row.yolo, true);
  assert.equal(row.accessTokenLifetimeSeconds, 3600);
  assert.equal(row.refreshFamilyExpiresAt, '2099-02-01T00:00:00.000Z');
  assert.equal(JSON.stringify(row).includes('token'), false);
  assert.equal(JSON.stringify(row).includes('hash'), false);
});

test('connection admin projection distinguishes grace offline and revoked', () => {
  const rows = [
    {
      subject: 'grace',
      actor: 'oauth:ChatGPT',
      status: 'ACTIVE',
      yoloEnabled: false,
      lastUsedAt: '2026-08-26T00:00:00.000Z',
      graceExpiresAt: '2099-01-01T00:00:00.000Z',
    },
    {
      subject: 'offline',
      actor: 'oauth:Claude',
      status: 'ACTIVE',
      yoloEnabled: false,
      lastUsedAt: '2026-08-26T00:00:00.000Z',
    },
    {
      subject: 'revoked',
      actor: 'oauth:Other',
      status: 'REVOKED',
      yoloEnabled: false,
      lastUsedAt: '2026-08-26T00:00:00.000Z',
    },
  ];
  const service = new ConnectionAdminService(
    {
      listConnections: () => rows,
      getLatestRefreshFamily: () => null,
    } as any,
    { list: () => [] } as any,
    3600,
    () => new Date('2026-08-26T00:00:00.000Z'),
  );

  assert.deepEqual(
    service.list().map((row) => row.status),
    ['GRACE', 'OFFLINE', 'REVOKED'],
  );
});

test('Admin connection routes list and force-revoke durable OAuth connections', async () => {
  const calls: any[] = [];
  const connections = {
    list: () => [{ connectionId: 'oauth_grant_1', status: 'OFFLINE' }],
    revoke: (id: string) => {
      calls.push(id);
      return id === 'oauth_grant_1';
    },
  };
  const context = {
    connections,
    audit: { append: (row: any) => calls.push(row) },
  };

  const listed = await call('/api/connections', 'GET', context);
  assert.equal(listed.status, 200);
  assert.equal(listed.value[0].connectionId, 'oauth_grant_1');

  const revoked = await call('/api/connections/oauth_grant_1/revoke', 'POST', context);
  assert.equal(revoked.status, 200);
  assert.equal(calls[0], 'oauth_grant_1');
  assert.equal(calls[1].operation, 'connection.revoke');

  const missing = await call('/api/connections/missing/revoke', 'POST', context);
  assert.equal(missing.status, 404);
});
