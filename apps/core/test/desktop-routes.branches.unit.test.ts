import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleDesktopRoutes } from '../src/admin/routes/desktop-routes.js';

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
  const handled = await handleDesktopRoutes(
    request(method, body, raw),
    res,
    new URL(`https://localhost${path}`),
    context,
  );
  return { handled, status: res.statusCode, value: res.body ? JSON.parse(res.body) : undefined };
}

function fakes() {
  const calls: unknown[][] = [];
  const desktopAppCatalog = {
    list: async () => ({ apps: [{ id: 'notes' }] }),
    saveCustom: async (input: unknown) => (calls.push(['saveCustom', input]), { id: 'custom' }),
    deleteCustom: (id: string, actor: string) => (calls.push(['deleteCustom', id, actor]), { id }),
    grant: async (input: unknown, actor: string) => (
      calls.push(['grant', input, actor]), { grantId: 'g1' }
    ),
  };
  const desktopAccess = {
    listPending: () => [{ id: 'r1' }],
    approve: async (id: string, scope: unknown, actor: string) => (
      calls.push(['approve', id, scope, actor]), { approved: id }
    ),
    deny: (id: string, actor: string) => (calls.push(['deny', id, actor]), { denied: id }),
    listGrants: () => [{ id: 'g1' }],
    revokeGrant: (id: string, actor: string) => (calls.push(['revoke', id, actor]), { revoked: id }),
  };
  return { calls, context: { desktopAppCatalog, desktopAccess } };
}

const unwiredRoutes: Array<[string, string]> = [
  ['PUT', '/api/desktop/custom-apps'],
  ['DELETE', '/api/desktop/custom-apps/c1'],
  ['GET', '/api/desktop/access-requests'],
  ['POST', '/api/desktop/access-requests/r1/approve'],
  ['GET', '/api/desktop/app-grants'],
  ['POST', '/api/desktop/app-grants'],
  ['DELETE', '/api/desktop/app-grants/g1'],
  ['GET', '/api/desktop/policy'],
];

test('each desktop route reports DESKTOP_UNAVAILABLE when its service is not wired', async () => {
  for (const [method, path] of unwiredRoutes) {
    const result = await call({}, path, method, {});
    assert.equal(result.status, 503, `${method} ${path}`);
    assert.equal(result.value.error.code, 'DESKTOP_UNAVAILABLE');
  }
});

test('the app catalog serves listings, custom apps and grants with the admin actor', async () => {
  const fx = fakes();
  const listed = await call(fx.context, '/api/desktop/apps');
  assert.deepEqual(listed.value, { apps: [{ id: 'notes' }] });
  const saved = await call(fx.context, '/api/desktop/custom-apps', 'PUT', { name: 'Tool' });
  assert.deepEqual(saved.value, { app: { id: 'custom' } });
  const deleted = await call(fx.context, '/api/desktop/custom-apps/my%20app', 'DELETE');
  assert.deepEqual(deleted.value, { app: { id: 'my app' } });
  const granted = await call(fx.context, '/api/desktop/app-grants', 'POST', { app: 'notes' });
  assert.deepEqual(granted.value, { grant: { grantId: 'g1' } });
  assert.deepEqual(fx.calls, [
    ['saveCustom', { name: 'Tool' }],
    ['deleteCustom', 'my app', 'admin'],
    ['grant', { app: 'notes' }, 'admin'],
  ]);
});

test('access review lists, approves with scope, denies and revokes grants', async () => {
  const fx = fakes();
  assert.deepEqual((await call(fx.context, '/api/desktop/access-requests')).value, {
    requests: [{ id: 'r1' }],
  });
  const approved = await call(fx.context, '/api/desktop/access-requests/r%201/approve', 'POST', {
    scope: 'session',
  });
  assert.deepEqual(approved.value, { approved: 'r 1' });
  const denied = await call(fx.context, '/api/desktop/access-requests/r2/deny', 'POST');
  assert.deepEqual(denied.value, { denied: 'r2' });
  assert.deepEqual((await call(fx.context, '/api/desktop/app-grants')).value, {
    grants: [{ id: 'g1' }],
  });
  const revoked = await call(fx.context, '/api/desktop/app-grants/g%2F1', 'DELETE');
  assert.deepEqual(revoked.value, { revoked: 'g/1' });
  assert.deepEqual(fx.calls, [
    ['approve', 'r 1', 'session', 'admin'],
    ['deny', 'r2', 'admin'],
    ['revoke', 'g/1', 'admin'],
  ]);
});

test('policy update passes an empty object for a null body and maps error fields', async () => {
  const updates: unknown[] = [];
  const desktopPolicy = {
    snapshot: () => ({ mode: 'denylist' }),
    update: (input: unknown) => {
      updates.push(input);
      if (updates.length > 1) throw {};
      return { mode: 'allowlist' };
    },
  };
  const ok = await call({ desktopPolicy }, '/api/desktop/policy', 'POST', undefined, 'null');
  assert.deepEqual([ok.status, ok.value], [200, { mode: 'allowlist' }]);
  assert.deepEqual(updates[0], {});
  const failed = await call({ desktopPolicy }, '/api/desktop/policy', 'POST', { mode: 'x' });
  assert.equal(failed.status, 400);
  assert.deepEqual(failed.value.error, {
    code: 'DESKTOP_POLICY_INVALID',
    message: 'Invalid desktop policy',
  });
  const coded = {
    snapshot: () => ({}),
    update: () => {
      throw { code: 'MODE_LOCKED', message: 'locked by admin' };
    },
  };
  const locked = await call({ desktopPolicy: coded }, '/api/desktop/policy', 'POST', {});
  assert.deepEqual(locked.value.error, { code: 'MODE_LOCKED', message: 'locked by admin' });
  const snapshot = await call({ desktopPolicy }, '/api/desktop/policy');
  assert.deepEqual(snapshot.value, { mode: 'denylist' });
});

test('unrelated desktop paths and methods fall through', async () => {
  const fx = fakes();
  assert.equal((await call(fx.context, '/api/desktop/other')).handled, false);
  assert.equal((await call(fx.context, '/api/desktop/access-requests/r1/maybe', 'POST')).handled, false);
  const noPolicy = await call(fx.context, '/api/desktop/custom-apps', 'GET');
  assert.equal(noPolicy.status, 503);
  const wrongMethod = await call(
    { ...fx.context, desktopPolicy: { snapshot: () => ({}) } },
    '/api/desktop/app-grants/g1',
    'GET',
  );
  assert.equal(wrongMethod.handled, false);
});
