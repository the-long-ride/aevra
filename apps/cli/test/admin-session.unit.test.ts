import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adminApi,
  createAuthenticatedUiUrl,
  revokeAllAdminSessions,
} from '../src/admin-session.js';

function response(options: {
  ok?: boolean;
  status?: number;
  body?: Record<string, unknown>;
  setCookie?: string;
} = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    headers: {
      get(name: string) {
        return name.toLowerCase() === 'set-cookie'
          ? (options.setCookie ?? '')
          : null;
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
    controlSecret: async () => 'control-secret',
    base: () => 'https://localhost:47831',
    fetch: async (
      _config: object,
      path: string,
      init: { method?: string; headers?: Record<string, string>; body?: string } = {},
    ) => {
      calls.push({ path, init });
      if (path === '/api/local/bootstrap') {
        return response({ body: { token: 'boot-token' } });
      }
      if (path.startsWith('/auth/bootstrap')) {
        return response({ setCookie: 'aevra_admin=session-token; HttpOnly' });
      }
      return response();
    },
  };
  return { calls, dependencies };
}

test('adminApi bootstraps a cookie before the requested API call', async () => {
  const { calls, dependencies } = transport();

  const result = await adminApi(
    {},
    '/api/connectors',
    { method: 'GET' },
    dependencies,
  );

  assert.equal(result.status, 200);
  assert.deepEqual(
    calls.map((call) => call.path),
    [
      '/api/local/bootstrap',
      '/auth/bootstrap?token=boot-token',
      '/api/connectors',
    ],
  );
  assert.equal(calls[0]!.init.headers?.['x-aevra-control'], 'control-secret');
  assert.equal(calls[2]!.init.headers?.cookie, 'aevra_admin=session-token');
});

test('createAuthenticatedUiUrl returns vanilla bootstrap URL by default', async () => {
  const { calls, dependencies } = transport();

  const url = await createAuthenticatedUiUrl({}, dependencies);

  assert.equal(url, 'https://localhost:47831/auth/bootstrap?token=boot-token');
  assert.deepEqual(calls.map((call) => call.path), ['/api/local/bootstrap']);
});

test('createAuthenticatedUiUrl encodes the React destination', async () => {
  const { calls, dependencies } = transport();

  const url = await createAuthenticatedUiUrl({}, dependencies, '/react/');

  assert.equal(
    url,
    'https://localhost:47831/auth/bootstrap?token=boot-token&to=%2Freact%2F',
  );
  assert.deepEqual(calls.map((call) => call.path), ['/api/local/bootstrap']);
});

test('revokeAllAdminSessions authenticates with the local control secret', async () => {
  const { calls, dependencies } = transport();

  const status = await revokeAllAdminSessions({}, dependencies);

  assert.equal(status, 200);
  assert.equal(calls[0]!.path, '/api/local/logout-all');
  assert.equal(calls[0]!.init.headers?.['x-aevra-control'], 'control-secret');
});
