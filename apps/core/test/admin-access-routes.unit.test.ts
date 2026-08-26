import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleAccessRoutes } from '../src/admin/routes/access-routes.js';

function request(method: string, value?: unknown) {
  const text = value === undefined ? '' : JSON.stringify(value);
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
    end(v = '') {
      result.body = String(v);
    },
  };
  return result as any;
}
async function call(pathname: string, method: string, context: any = {}, value?: unknown) {
  const res = response();
  const handled = await handleAccessRoutes(
    request(method, value),
    res,
    new URL(`https://localhost${pathname}`),
    context,
  );
  return { handled, status: res.statusCode, value: res.body ? JSON.parse(res.body) : undefined };
}

test('OAuth access routes list approve deny audit and missing requests', async () => {
  const audit: any[] = [];
  const context = {
    oauth: {
      listClients: () => [{ id: 'client' }],
      listPendingAuthorizations: () => [{ id: 'req' }],
      approveAuthorization: (id: string) => (id === 'ok' ? { id, state: 'approved' } : null),
      denyAuthorization: (id: string) => (id === 'deny' ? { id, state: 'denied' } : null),
    },
    audit: { append: (row: any) => audit.push(row) },
  };
  assert.equal((await call('/api/oauth/clients', 'GET', context)).value[0].id, 'client');
  assert.equal((await call('/api/oauth/requests', 'GET', context)).value[0].id, 'req');
  const approved = await call('/api/oauth/requests/ok/approve', 'POST', context);
  assert.equal(approved.value.request.state, 'approved');
  const denied = await call('/api/oauth/requests/deny/deny', 'POST', context);
  assert.equal(denied.value.request.state, 'denied');
  assert.deepEqual(
    audit.map((row) => row.operation),
    ['oauth.authorize.approve', 'oauth.authorize.deny'],
  );
  const missing = await call('/api/oauth/requests/missing/approve', 'POST', context);
  assert.equal(missing.status, 404);
  assert.equal(missing.value.error.code, 'OAUTH_REQUEST_NOT_FOUND');
  assert.deepEqual((await call('/api/oauth/clients', 'GET')).value, []);
  assert.deepEqual((await call('/api/oauth/requests', 'GET')).value, []);
});

test('exposure status covers local defaults health fallbacks and configured HTTPS', async () => {
  const local = await call('/api/exposure/status', 'GET', {});
  assert.equal(local.value.provider, 'local');
  assert.equal(local.value.health.gateway, 'stopped');
  assert.equal(local.value.health.publicHttps, 'not exposed');
  assert.equal(local.value.health.mcp, 'unknown');
  assert.equal(local.value.health.oauth, 'unavailable');
  assert.equal(local.value.health.tls, 'unavailable');

  const ready = await call('/api/exposure/status', 'GET', {
    exposure: {
      status: () => ({
        provider: 'direct',
        state: undefined,
        localGatewayUrl: 'http://127.0.0.1:1',
        publicUrl: 'https://example.com',
        oauth: { issuer: 'https://example.com', resource: 'https://example.com/mcp' },
        health: { custom: 'ok' },
      }),
    },
    mcpDiagnostics: () => ({ state: 'degraded' }),
  });
  assert.equal(ready.value.health.providerProcess, 'unknown');
  assert.equal(ready.value.health.gateway, 'reachable');
  assert.equal(ready.value.health.mcp, 'degraded');
  assert.equal(ready.value.health.oauth, 'healthy');
  assert.equal(ready.value.health.tls, 'ready');
  assert.equal(ready.value.health.custom, 'ok');
});

test('exposure configure and test routes require a service and delegate when available', async () => {
  await assert.rejects(
    () => call('/api/exposure/config', 'POST', {}, { provider: 'local' }),
    (e: any) => e.status === 503,
  );
  await assert.rejects(
    () => call('/api/exposure/test', 'POST', {}),
    (e: any) => e.status === 503,
  );
  const configured = await call(
    '/api/exposure/config',
    'POST',
    {
      exposure: { configure: async (input: any) => ({ input }) },
    },
    { provider: 'external' },
  );
  assert.equal(configured.value.input.provider, 'external');
  const tested = await call('/api/exposure/test', 'POST', {
    exposure: { test: async () => ({ reachable: true }) },
  });
  assert.equal(tested.value.reachable, true);
});

test('Cloudflare routes cover detection auth setup reachability and fallbacks', async () => {
  const defaults = await call('/api/cloudflare/status', 'GET', {});
  assert.equal(defaults.value.found, false);
  assert.equal(defaults.value.authenticated, false);
  assert.equal(defaults.value.ownership, 'managed');
  assert.equal(defaults.value.authMode, 'connector');

  const access = await call('/api/cloudflare/status', 'GET', {
    cloudflare: {
      detectCloudflared: async () => ({ found: true, version: '1' }),
      authenticationStatus: async () => ({ authenticated: true, message: 'ok' }),
      ownership: () => 'external',
    },
    settings: { get: () => ({ issuer: 'i', audience: 'a' }) },
  });
  assert.equal(access.value.authMode, 'access');
  assert.equal(access.value.authenticationMessage, 'ok');
  const explicit = await call('/api/cloudflare/status', 'GET', {
    settings: { get: () => ({ authMode: 'connector' }) },
  });
  assert.equal(explicit.value.authMode, 'connector');

  await assert.rejects(
    () =>
      call('/api/cloudflare/authenticate', 'POST', {
        cloudflare: { authenticate: async () => undefined },
      }),
    /unknown error/,
  );
  await assert.rejects(
    () =>
      call('/api/cloudflare/authenticate', 'POST', {
        cloudflare: { authenticate: async () => ({ code: 1, stderr: 'bad' }) },
      }),
    /bad/,
  );
  const authenticated = await call('/api/cloudflare/authenticate', 'POST', {
    cloudflare: { authenticate: async () => ({ code: 0, stdout: '', stderr: '' }) },
  });
  assert.equal(authenticated.value.message, 'Cloudflare authentication completed');

  const calls: string[] = [];
  const setup = await call(
    '/api/cloudflare/setup',
    'POST',
    {
      cloudflare: {
        setup: async () => ({ hostname: 'mcp.example.com', ownership: 'managed' }),
        startManagedTunnel: async () => calls.push('start'),
      },
      oauth: { setPublicBaseUrl: (url: string) => calls.push(url) },
    },
    { mode: 'managed' },
  );
  assert.equal(setup.value.ok, true);
  assert.deepEqual(calls, ['https://mcp.example.com', 'start']);
  await call(
    '/api/cloudflare/setup',
    'POST',
    {
      cloudflare: { setup: async () => ({ ownership: 'external' }) },
    },
    {},
  );

  const fallback = await call('/api/cloudflare/test', 'POST', {});
  assert.equal(fallback.value.reachable, false);
  const reach = await call('/api/cloudflare/test', 'POST', {
    cloudflare: { checkReachability: async () => ({ reachable: true }) },
  });
  assert.equal(reach.value.reachable, true);
});

test('secret environment vault and config routes cover defaults and mutations', async () => {
  const calls: any[] = [];
  const context = {
    environment: {
      listSecretRefs: () => [{ ref: 'TOKEN' }],
      setSecret: async (...args: any[]) => {
        calls.push(['setSecret', ...args]);
        return { ref: args[0], value: 'hidden' };
      },
      deleteSecret: async (ref: string) => calls.push(['deleteSecret', ref]),
      list: () => [{ id: 'p1' }],
      create: (...args: any[]) => {
        calls.push(['create', ...args]);
        return { id: 'p2', name: args[0] };
      },
    },
    vault: {
      unlock: (pass: string) => calls.push(['unlock', pass]),
      lock: () => calls.push(['lock']),
    },
    database: {
      configExport: (portable: boolean) => ({ portable }),
      configPreview: (input: any) => ({ adds: input.adds ?? 0 }),
    },
  };
  assert.equal((await call('/api/secret-references', 'GET', context)).value[0].ref, 'TOKEN');
  const secret = await call('/api/secret-references', 'POST', context, {
    ref: 'TOKEN',
    value: 123,
  });
  assert.equal(secret.value.secret.ref, 'TOKEN');
  assert.equal('value' in secret.value.secret, false);
  await call('/api/secret-references/TOKEN', 'DELETE', context);
  assert.equal((await call('/api/environment-profiles', 'GET', context)).value[0].id, 'p1');
  const profile = await call('/api/environment-profiles', 'POST', context, { name: 'Dev' });
  assert.equal(profile.value.profile.name, 'Dev');
  await call('/api/environment-profiles', 'POST', context, {
    name: 'Full',
    vars: { A: '1' },
    secretRefs: { A: 'TOKEN' },
  });
  await call('/api/vault/unlock', 'POST', context, {});
  await call('/api/vault/unlock', 'POST', context, { passphrase: 'pw' });
  await call('/api/vault/lock', 'POST', context);
  assert.equal((await call('/api/config/export?portable=1', 'GET', context)).value.portable, true);
  assert.equal((await call('/api/config/export', 'GET', context)).value.portable, false);
  assert.equal(
    (await call('/api/config/import-preview', 'POST', context, { adds: 2 })).value.adds,
    2,
  );
  assert.ok(calls.some((row) => row[0] === 'unlock' && row[1] === ''));

  assert.deepEqual((await call('/api/secret-references', 'GET')).value, []);
  assert.deepEqual((await call('/api/environment-profiles', 'GET')).value, []);
  assert.deepEqual((await call('/api/config/export', 'GET')).value, {});
  assert.deepEqual((await call('/api/config/import-preview', 'POST', {}, {})).value, {
    adds: 0,
    changes: 0,
    pathRemaps: 0,
    secretReconnects: 0,
  });
  assert.equal((await call('/api/not-access', 'GET')).handled, false);
});

test('Admin exposure test route requires and delegates to the Admin probe service', async () => {
  await assert.rejects(
    () => call('/api/exposure/admin/test', 'POST', {}),
    (e: any) => e.status === 503,
  );
  let candidate: unknown;
  const tested = await call(
    '/api/exposure/admin/test',
    'POST',
    {
      exposure: {
        testAdmin: async (input: unknown) => {
          candidate = input;
          return {
            configured: true,
            trusted: true,
            reachable: true,
            publicUrl: 'https://admin.example.com',
          };
        },
      },
    },
    { publicUrl: 'https://admin.example.com/control', trustedOrigins: ['https://ops.example.com'] },
  );
  assert.deepEqual(candidate, {
    publicUrl: 'https://admin.example.com/control',
    trustedOrigins: ['https://ops.example.com'],
  });
  assert.equal(tested.value.reachable, true);
  assert.equal(tested.value.trusted, true);
});
