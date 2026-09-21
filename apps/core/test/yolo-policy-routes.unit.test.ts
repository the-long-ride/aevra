import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleYoloPolicyRoutes } from '../src/admin/routes/yolo-policy-routes.js';

function request(method: string, body?: unknown) {
  const text = body === undefined ? '' : JSON.stringify(body);
  const stream = Readable.from(text ? [Buffer.from(text)] : []) as any;
  stream.method = method;
  stream.headers = {};
  return stream;
}

function response() {
  const res = {
    statusCode: 0,
    body: '',
    setHeader() {},
    end(v = '') {
      res.body = String(v);
    },
  };
  return res as any;
}

test('handleYoloPolicyRoutes: GET, PATCH, and method dispatch', async () => {
  let stored = { mode: 'workspace' };
  const context: any = {
    settings: {
      get: () => stored,
      set: (_k: string, v: any) => {
        stored = v;
      },
    },
  };

  // GET
  const resGet = response();
  assert.equal(
    await handleYoloPolicyRoutes(
      request('GET'),
      resGet,
      new URL('https://localhost/api/policy/yolo'),
      context,
    ),
    true,
  );
  assert.equal(JSON.parse(resGet.body).mode, 'workspace');

  // PATCH
  const resPatch = response();
  assert.equal(
    await handleYoloPolicyRoutes(
      request('PATCH', { mode: 'unrestricted' }),
      resPatch,
      new URL('https://localhost/api/policy/yolo'),
      context,
    ),
    true,
  );
  assert.equal(JSON.parse(resPatch.body).mode, 'unrestricted');
  assert.equal(stored.mode, 'unrestricted');

  // Non-matching path
  assert.equal(
    await handleYoloPolicyRoutes(
      request('GET'),
      response(),
      new URL('https://localhost/api/other'),
      context,
    ),
    false,
  );

  // Non-matching method
  assert.equal(
    await handleYoloPolicyRoutes(
      request('DELETE'),
      response(),
      new URL('https://localhost/api/policy/yolo'),
      context,
    ),
    false,
  );
});
