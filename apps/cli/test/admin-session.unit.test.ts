import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adminApi,
  createAuthenticatedUiUrl,
  revokeAllAdminSessions,
} from '../src/admin-session.js';

function response(
  options: {
    ok?: boolean;
    status?: number;
    body?: Record<string, unknown>;
    setCookie?: string;
    retryAfter?: string;
  } = {},
) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    headers: {
      get(name: string) {
        if (name.toLowerCase() === 'set-cookie') return options.setCookie ?? '';
        if (name.toLowerCase() === 'retry-after') return options.retryAfter ?? null;
        return null;
      },
    },
    async json() {
      return options.body ?? {};
    },
  };
}

function transport() {
  const calls: Array<{
    path: string;
    init: { method?: string; headers?: Record<string, string>; body?: string };
  }> = [];
  const dependencies = {
    async controlSecret() {
      return 'control-secret';
    },
    async credentials() {
      return { username: 'admin', password: 'secret' };
    },
    base: () => 'https://localhost:47831',
    fetch: async (
      _config: object,
      path: string,
      init: { method?: string; headers?: Record<string, string>; body?: string } = {},
    ) => {
      calls.push({ path, init });
      if (path === '/api/auth/login') {
        return response({ setCookie: 'aevra_admin=session-token; Secure; HttpOnly' });
      }
      return response();
    },
  };
  return { calls, dependencies };
}

test('adminApi logs in with mandatory admin credentials before the requested API call', async () => {
  const { calls, dependencies } = transport();
  const result = await adminApi({}, '/api/connectors', { method: 'GET' }, dependencies);

  assert.equal(result.status, 200);
  assert.deepEqual(
    calls.map((call) => call.path),
    ['/api/auth/login', '/api/connectors'],
  );
  assert.equal(calls[0]!.init.method, 'POST');
  assert.equal(calls[0]!.init.headers?.['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0]!.init.body ?? '{}'), {
    username: 'admin',
    password: 'secret',
  });
  assert.equal(calls[1]!.init.headers?.cookie, 'aevra_admin=session-token');
});

test('adminApi reports login rate limiting instead of implying Core is down', async () => {
  const { dependencies } = transport();
  dependencies.fetch = async (_config, path) =>
    path === '/api/auth/login'
      ? response({
          ok: false,
          status: 429,
          body: { error: 'Too many login attempts' },
          retryAfter: '60',
        })
      : response();

  await assert.rejects(
    adminApi({}, '/api/connectors', { method: 'GET' }, dependencies),
    (error: Error & { code?: string }) => {
      assert.equal(error.code, 'ADMIN_LOGIN_RATE_LIMITED');
      assert.match(error.message, /retry in 60s/);
      return true;
    },
  );
});

test('createAuthenticatedUiUrl opens the login page without creating a session', async () => {
  const { calls, dependencies } = transport();
  const url = await createAuthenticatedUiUrl({}, dependencies);

  assert.equal(url, 'https://localhost:47831/');
  assert.deepEqual(calls, []);
});

test('the single typed UI destination keeps the root login route', async () => {
  const { calls, dependencies } = transport();
  const url = await createAuthenticatedUiUrl({}, dependencies, '/');
  assert.equal(url, 'https://localhost:47831/');
  assert.deepEqual(calls, []);
});

test('revokeAllAdminSessions authenticates with the local control secret', async () => {
  const { calls, dependencies } = transport();
  const status = await revokeAllAdminSessions({}, dependencies);

  assert.equal(status, 200);
  assert.equal(calls[0]!.path, '/api/local/logout-all');
  assert.equal(calls[0]!.init.headers?.['x-aevra-control'], 'control-secret');
});
