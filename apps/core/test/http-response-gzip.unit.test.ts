import assert from 'node:assert/strict';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { acceptsGzip, sendJsonBody } from '../src/mcp/http-response.js';

function fakeRes() {
  const state: { status?: number; headers: Record<string, unknown>; body?: Buffer | string } = {
    headers: {},
  };
  const res = {
    set statusCode(value: number) {
      state.status = value;
    },
    setHeader(name: string, value: unknown) {
      state.headers[name.toLowerCase()] = value;
    },
    end(chunk?: Buffer | string) {
      state.body = chunk;
    },
  };
  return { res: res as never, state };
}

const big = JSON.stringify({ text: 'abcdefgh'.repeat(400) });

test('acceptsGzip honours q-values and ignores other encodings', () => {
  assert.equal(acceptsGzip({ headers: { 'accept-encoding': 'gzip, deflate' } }), true);
  assert.equal(acceptsGzip({ headers: { 'accept-encoding': 'GZIP;q=0.5' } }), true);
  assert.equal(acceptsGzip({ headers: { 'accept-encoding': 'gzip;q=0' } }), false);
  assert.equal(acceptsGzip({ headers: { 'accept-encoding': 'br' } }), false);
  assert.equal(acceptsGzip({ headers: {} }), false);
});

test('large bodies are gzipped for clients that accept it', async () => {
  const { res, state } = fakeRes();
  await sendJsonBody(res, 200, big, { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(state.status, 200);
  assert.equal(state.headers['content-encoding'], 'gzip');
  assert.equal(state.headers.vary, 'accept-encoding');
  assert.equal(gunzipSync(state.body as Buffer).toString('utf8'), big);
  assert.ok((state.body as Buffer).length < big.length / 4);
});

test('small bodies and clients without gzip get the plain body', async () => {
  const small = fakeRes();
  await sendJsonBody(small.res, 200, '{"ok":true}', { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(small.state.headers['content-encoding'], undefined);
  assert.equal(small.state.body, '{"ok":true}');
  const plain = fakeRes();
  await sendJsonBody(plain.res, 200, big, { headers: {} });
  assert.equal(plain.state.headers['content-encoding'], undefined);
  assert.equal(plain.state.body, big);
  const noReq = fakeRes();
  await sendJsonBody(noReq.res, 200, big);
  assert.equal(noReq.state.headers['content-encoding'], undefined);
});

test('the content type matches sendJson', async () => {
  const { res, state } = fakeRes();
  await sendJsonBody(res, 200, '{}');
  assert.equal(state.headers['content-type'], 'application/json');
});
