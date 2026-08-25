import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleAdminApi } from '../src/admin/routes/api.js';

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
    end(value = '') {
      result.body = String(value);
    },
  };
  return result as any;
}

async function call(pathname: string, method: string, context: any, value?: unknown) {
  const res = response();
  const handled = await handleAdminApi(
    request(method, value),
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

test('exposure status includes provider-neutral runtime health', async () => {
  const checkedAt = '2026-08-26T00:00:00.000Z';
  const result = await call('/api/exposure/status', 'GET', {
    exposure: {
      status: () => ({
        provider: 'ngrok',
        state: 'ready',
        localGatewayUrl: 'https://127.0.0.1:47830',
        publicUrl: 'https://aevra.ngrok.app',
        tunnelHealth: { reachable: false, checkedAt, message: 'upstream unavailable' },
        oauth: {
          issuer: 'https://aevra.ngrok.app',
          resource: 'https://aevra.ngrok.app/mcp',
        },
      }),
    },
    mcpDiagnostics: () => ({ state: 'listening' }),
  });
  assert.equal(result.handled, true);
  assert.equal(result.status, 200);
  assert.equal(result.value.provider, 'ngrok');
  assert.equal(result.value.health.providerProcess, 'ready');
  assert.equal(result.value.health.gateway, 'reachable');
  assert.equal(result.value.health.publicHttps, 'unreachable');
  assert.equal(result.value.health.admin, 'reachable');
  assert.equal(result.value.health.mcp, 'reachable');
  assert.equal(result.value.health.oauth, 'healthy');
  assert.equal(result.value.health.tls, 'ready');
  assert.equal(result.value.checkedAt, checkedAt);
});

test('exposure config delegates validated lifecycle changes to the controller', async () => {
  let configured: unknown;
  const input = {
    provider: 'external',
    publicUrl: 'https://aevra.example.com',
  };
  const result = await call(
    '/api/exposure/config',
    'POST',
    {
      exposure: {
        async configure(value: unknown) {
          configured = value;
          return {
            config: input,
            status: { provider: 'external', state: 'ready', publicUrl: input.publicUrl },
          };
        },
      },
    },
    input,
  );
  assert.deepEqual(configured, input);
  assert.equal(result.status, 200);
  assert.equal(result.value.status.provider, 'external');
});

test('exposure test is provider-neutral', async () => {
  const result = await call('/api/exposure/test', 'POST', {
    exposure: {
      async test() {
        return { reachable: true, provider: 'direct' };
      },
    },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.value, { reachable: true, provider: 'direct' });
});
