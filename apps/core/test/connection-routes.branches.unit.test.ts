import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleConnectionRoutes } from '../src/admin/routes/connection-routes.js';

function request(method: string | undefined, body?: unknown, raw?: string) {
  const text = raw ?? (body === undefined ? '' : JSON.stringify(body));
  const stream = Readable.from(text ? [Buffer.from(text)] : []) as any;
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

async function call(context: any, path: string, method?: string, body?: unknown, raw?: string) {
  const res = response();
  const handled = await handleConnectionRoutes(
    request(method, body, raw),
    res,
    new URL(`https://localhost${path}`),
    context,
  );
  return { handled, status: res.statusCode, value: res.body ? JSON.parse(res.body) : undefined };
}

function failing(error: unknown) {
  return () => {
    throw error;
  };
}

test('connection list and control snapshot fall back without a connection service', async () => {
  assert.deepEqual((await call({}, '/api/connections')).value, []);
  const control = await call({}, '/api/connections/c%201/control');
  assert.deepEqual(control.value, { connectionId: 'c 1', browser: false, desktop: false });
});

test('control grant validates capability and audits success', async () => {
  const audits: any[] = [];
  const granted: string[] = [];
  const context = {
    connections: { grantControl: (id: string, cap: string) => granted.push(`${id}:${cap}`) },
    audit: { append: (entry: any) => audits.push(entry) },
  };
  const nullBody = await call(context, '/api/connections/c1/control', 'POST', undefined, 'null');
  assert.deepEqual([nullBody.status, nullBody.value.error.code], [400, 'INVALID_REQUEST']);
  const ok = await call(context, '/api/connections/c1/control', 'POST', {
    capability: 'desktop.control',
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(granted, ['c1:desktop.control']);
  assert.equal(audits[0].operation, 'connection.control_grant');
  assert.equal(audits[0].target, 'c1:desktop.control');
  const unwired = await call({}, '/api/connections/c1/control', 'POST', {
    capability: 'browser.control',
  });
  assert.equal(unwired.status, 200);
});

test('control grant failures map NOT_FOUND to 404 and other errors to 400', async () => {
  const notFound = await call(
    { connections: { grantControl: failing({ code: 'NOT_FOUND', message: 'missing' }) } },
    '/api/connections/c1/control',
    'POST',
    { capability: 'browser.control' },
  );
  assert.deepEqual([notFound.status, notFound.value.error.code], [404, 'NOT_FOUND']);
  const bare = await call(
    { connections: { grantControl: failing(undefined) } },
    '/api/connections/c1/control',
    'POST',
    { capability: 'browser.control' },
  );
  assert.equal(bare.status, 400);
  assert.deepEqual(bare.value.error, { code: 'INVALID_REQUEST', message: 'Request failed' });
  const invalidJson = await call({}, '/api/connections/c1/control', 'POST', undefined, '{');
  assert.deepEqual([invalidJson.status, invalidJson.value.error.message], [400, 'invalid JSON']);
});

test('control revoke rejects unknown capabilities and maps failures', async () => {
  const bad = await call({}, '/api/connections/c1/control/files.write', 'DELETE');
  assert.equal(bad.status, 400);
  const revoked: string[] = [];
  const audits: any[] = [];
  const ok = await call(
    {
      connections: {
        revokeControl: async (id: string, cap: string) => revoked.push(`${id}|${cap}`),
      },
      audit: { append: (entry: any) => audits.push(entry) },
    },
    '/api/connections/c%2F1/control/browser.control',
    'DELETE',
  );
  assert.equal(ok.status, 200);
  assert.deepEqual(revoked, ['c/1|browser.control']);
  assert.equal(audits[0].operation, 'connection.control_revoke');
  assert.equal(
    (await call({}, '/api/connections/c1/control/desktop.control', 'DELETE')).status,
    200,
  );
  const missing = await call(
    { connections: { revokeControl: async () => Promise.reject({ code: 'NOT_FOUND' }) } },
    '/api/connections/c1/control/desktop.control',
    'DELETE',
  );
  assert.deepEqual(missing.value.error, { code: 'NOT_FOUND', message: 'Request failed' });
  assert.equal(missing.status, 404);
  const other = await call(
    { connections: { revokeControl: failing(null) } },
    '/api/connections/c1/control/desktop.control',
    'DELETE',
  );
  assert.deepEqual([other.status, other.value.error.code], [400, 'INVALID_REQUEST']);
});

test('connection revoke reports 404 when nothing was revoked', async () => {
  assert.equal((await call({}, '/api/connections/c1/revoke', 'POST')).status, 404);
  const audits: any[] = [];
  const ok = await call(
    { connections: { revoke: () => true }, audit: { append: (e: any) => audits.push(e) } },
    '/api/connections/c1/revoke',
    'POST',
  );
  assert.equal(ok.status, 200);
  assert.deepEqual([audits[0].operation, audits[0].target], ['connection.revoke', 'c1']);
  assert.equal(
    (await call({ connections: { revoke: () => true } }, '/api/connections/c1/revoke', 'POST'))
      .status,
    200,
  );
});

test('workspace grant uses read-only by default and maps error statuses', async () => {
  const grants: string[] = [];
  const context = {
    connections: {
      grantWorkspace: (c: string, w: string, p: string) => grants.push(`${c}:${w}:${p}`),
    },
  };
  const missing = await call(context, '/api/connections/c1/workspaces', 'POST', undefined, 'null');
  assert.deepEqual([missing.status, missing.value.error.message], [400, 'workspaceId required']);
  const ok = await call(context, '/api/connections/c1/workspaces', 'POST', { workspaceId: 'w1' });
  assert.equal(ok.status, 200);
  assert.deepEqual(grants, ['c1:w1:read-only']);
  const cases: Array<[unknown, number, string]> = [
    [{ status: 418, code: 'TEAPOT', message: 'odd' }, 418, 'TEAPOT'],
    [{ code: 'NOT_FOUND', message: 'gone' }, 404, 'NOT_FOUND'],
    [{ code: 'CONFLICT', message: 'inactive' }, 409, 'CONFLICT'],
    [{ message: 'plain' }, 400, 'INVALID_REQUEST'],
    [{ status: 404, message: 'derived' }, 404, 'NOT_FOUND'],
    [{ status: 409, message: 'derived' }, 409, 'CONFLICT'],
  ];
  for (const [error, status, code] of cases) {
    const result = await call(
      { connections: { grantWorkspace: failing(error) } },
      '/api/connections/c1/workspaces',
      'POST',
      { workspaceId: 'w1', profileId: 'developer' },
    );
    assert.deepEqual([result.status, result.value.error.code], [status, code]);
  }
});

test('workspace revoke accepts DELETE or POST and maps error statuses', async () => {
  const missing = await call({}, '/api/connections/c1/workspaces/w1', 'DELETE');
  assert.deepEqual(
    [missing.status, missing.value.error.message],
    [404, 'Workspace grant not found'],
  );
  const audits: any[] = [];
  const ok = await call(
    {
      connections: { revokeWorkspace: (c: string, w: string) => c === 'c 1' && w === 'w/1' },
      audit: { append: (entry: any) => audits.push(entry) },
    },
    '/api/connections/c%201/workspaces/w%2F1',
    'POST',
  );
  assert.equal(ok.status, 200);
  assert.equal(audits[0].target, 'c 1:w/1');
  const cases: Array<[unknown, number, string]> = [
    [{ status: 423, code: 'LOCKED', message: 'x' }, 423, 'LOCKED'],
    [{ code: 'NOT_FOUND', message: 'x' }, 404, 'NOT_FOUND'],
    [{ code: 'CONFLICT', message: 'x' }, 409, 'CONFLICT'],
    [{ message: 'x' }, 400, 'INVALID_REQUEST'],
    [{ status: 404, message: 'x' }, 404, 'NOT_FOUND'],
    [{ status: 409, message: 'x' }, 409, 'CONFLICT'],
  ];
  for (const [error, status, code] of cases) {
    const result = await call(
      { connections: { revokeWorkspace: failing(error) } },
      '/api/connections/c1/workspaces/w1',
      'DELETE',
    );
    assert.deepEqual([result.status, result.value.error.code], [status, code]);
  }
  assert.equal((await call({}, '/api/connections/c1/workspaces/w1', 'GET')).handled, false);
  assert.equal((await call({}, '/api/connections/c1/control', 'PUT')).handled, false);
});
