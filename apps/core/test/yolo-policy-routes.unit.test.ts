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

const URL_YOLO = new URL('https://localhost/api/policy/yolo');

function fixture(initial: unknown = { mode: 'workspace' }) {
  const state: { stored: any; audits: any[] } = { stored: initial, audits: [] };
  const context: any = {
    settings: {
      get: () => state.stored,
      set: (_k: string, v: any) => {
        state.stored = v;
      },
    },
    audit: { append: (e: any) => state.audits.push(e) },
  };
  return { state, context };
}

async function call(context: any, method: string, body?: unknown) {
  const res = response();
  const handled = await handleYoloPolicyRoutes(request(method, body), res, URL_YOLO, context);
  return { handled, body: res.body ? JSON.parse(res.body) : undefined };
}

test('handleYoloPolicyRoutes: GET returns both axes with defaults', async () => {
  const { context } = fixture();
  const out = await call(context, 'GET');
  assert.equal(out.handled, true);
  assert.deepEqual(out.body, { mode: 'workspace', risk: 'prevent-high-risk' });
});

test('handleYoloPolicyRoutes: PATCH mode keeps stored risk', async () => {
  const { context, state } = fixture({ mode: 'unrestricted', risk: 'do-whatever' });
  const out = await call(context, 'PATCH', { mode: 'workspace' });
  assert.deepEqual(out.body, { mode: 'workspace', risk: 'do-whatever' });
  assert.deepEqual(state.stored, { mode: 'workspace', risk: 'do-whatever' });
});

test('handleYoloPolicyRoutes: PATCH risk keeps stored mode and audits', async () => {
  const { context, state } = fixture({ mode: 'unrestricted' });
  const out = await call(context, 'PATCH', { risk: 'do-whatever' });
  assert.deepEqual(out.body, { mode: 'unrestricted', risk: 'do-whatever' });
  assert.equal(state.audits.length, 1);
  assert.equal(state.audits[0].operation, 'policy.yolo.update');
  assert.equal(state.audits[0].actor, 'admin');
  assert.equal(state.audits[0].result, 'ok');
});

test('handleYoloPolicyRoutes: PATCH unknown values normalize to safe defaults', async () => {
  const { context } = fixture({ mode: 'unrestricted', risk: 'do-whatever' });
  const out = await call(context, 'PATCH', { mode: 'bogus', risk: 'bogus' });
  assert.deepEqual(out.body, { mode: 'workspace', risk: 'prevent-high-risk' });
});

test('handleYoloPolicyRoutes: non-matching path and method', async () => {
  const { context } = fixture();
  const res = response();
  assert.equal(
    await handleYoloPolicyRoutes(
      request('GET'),
      res,
      new URL('https://localhost/api/other'),
      context,
    ),
    false,
  );
  assert.equal((await call(context, 'DELETE')).handled, false);
});
