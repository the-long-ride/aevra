import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleAdminApi } from '../src/admin/routes/api.js';

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
  const handled = await handleAdminApi(
    request(method),
    res,
    new URL(`https://localhost${pathname}`),
    context,
  );
  return { handled, status: res.statusCode, value: res.body ? JSON.parse(res.body) : undefined };
}

const detected = {
  cloudflared: { available: true, version: '2026.5.2' },
  ngrok: { available: false },
  recommended: 'cloudflared',
};

test('GET tunnel tools returns the detected tunnel tool status', async () => {
  let calls = 0;
  const result = await call('/api/system/tunnel-tools', 'GET', {
    tunnelTools: async () => {
      calls += 1;
      return detected;
    },
  });
  assert.equal(result.handled, true);
  assert.equal(result.status, 200);
  assert.deepEqual(result.value, detected);
  assert.equal(calls, 1);
});

test('tunnel tool detection failures answer 503 instead of crashing', async () => {
  const result = await call('/api/system/tunnel-tools', 'GET', {
    tunnelTools: async () => {
      throw new Error('probe exploded');
    },
  });
  assert.equal(result.status, 503);
  assert.equal(result.value.error.code, 'TUNNEL_DETECTION_FAILED');
});

test('tunnel tools answer 503 when detection is not wired', async () => {
  const result = await call('/api/system/tunnel-tools', 'GET', {});
  assert.equal(result.status, 503);
  assert.equal(result.value.error.code, 'TUNNEL_DETECTION_UNAVAILABLE');
});

test('tunnel tools only answer GET', async () => {
  const result = await call('/api/system/tunnel-tools', 'POST', {
    tunnelTools: async () => detected,
  });
  assert.equal(result.handled, false);
});
