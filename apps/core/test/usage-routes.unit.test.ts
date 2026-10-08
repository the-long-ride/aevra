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

const usage = {
  report: (range: string) => ({ range, estimator: 'heuristic-v1' }) as any,
};

async function call(method: string, path: string, context: any = { usage }) {
  const res = response();
  const handled = await handleAdminApi(
    request(method),
    res,
    new URL(`https://localhost${path}`),
    context,
  );
  return { handled, status: res.statusCode, json: res.body ? JSON.parse(res.body) : undefined };
}

test('GET /api/usage/tokens defaults to 24h', async () => {
  const { status, json } = await call('GET', '/api/usage/tokens');
  assert.equal(status, 200);
  assert.equal(json.range, '24h');
  assert.equal(json.estimator, 'heuristic-v1');
});

test('every supported range is accepted', async () => {
  for (const range of ['24h', '7d', '30d', '90d', 'all']) {
    const { status, json } = await call('GET', `/api/usage/tokens?range=${range}`);
    assert.equal(status, 200);
    assert.equal(json.range, range);
  }
});

test('an unknown range is a 400 INVALID_RANGE', async () => {
  const { status, json } = await call('GET', '/api/usage/tokens?range=1y');
  assert.equal(status, 400);
  assert.equal(json.error.code, 'INVALID_RANGE');
});

test('other methods are 405 and other paths fall through', async () => {
  assert.equal((await call('POST', '/api/usage/tokens')).status, 405);
  assert.equal((await call('GET', '/api/something-else')).handled, false);
});

test('a context without usage answers 503 USAGE_UNAVAILABLE', async () => {
  const { status, json } = await call('GET', '/api/usage/tokens', {});
  assert.equal(status, 503);
  assert.equal(json.error.code, 'USAGE_UNAVAILABLE');
});
