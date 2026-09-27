import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleBrowserRoutes } from '../src/admin/routes/browser-routes.js';

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
  const handled = await handleBrowserRoutes(
    request(method, body, raw),
    res,
    new URL(`https://localhost${path}`),
    context,
  );
  return { handled, status: res.statusCode, value: res.body ? JSON.parse(res.body) : undefined };
}

function browser(unpair: (id: string) => Promise<unknown>) {
  const redeemed: unknown[] = [];
  return {
    redeemed,
    browser: {
      pairingHealth: async () => ({ ok: true }),
      state: (health: unknown) => ({ epoch: 1, sawHealth: Boolean(health) }),
      createCode: () => ({ code: 'sample value' }),
      redeem: async (input: unknown) => (redeemed.push(input), { paired: true }),
      unpair,
      revokeAll: async () => ({ epoch: 2 }),
    },
  };
}

test('browser routes report unavailable without a pairing service', async () => {
  const result = await call({}, '/api/browser/pairings/p1', 'DELETE');
  assert.deepEqual([result.status, result.value.error.code], [503, 'BROWSER_UNAVAILABLE']);
});

test('pairing ids that fail to decode or contain a slash are not browser routes', async () => {
  const fx = browser(async () => ({}));
  assert.equal((await call(fx, '/api/browser/pairings/%E0%A4%A', 'DELETE')).handled, false);
  assert.equal((await call(fx, '/api/browser/pairings/a%2Fb', 'DELETE')).handled, false);
  assert.equal((await call(fx, '/api/browser/unknown')).handled, false);
});

test('GET with a missing method reads state and health', async () => {
  const fx = browser(async () => ({}));
  const result = await call(fx, '/api/browser');
  assert.deepEqual(result.value, { epoch: 1, sawHealth: true, health: { ok: true } });
});

test('pair with a null body forwards empty identity strings', async () => {
  const fx = browser(async () => ({}));
  const result = await call(fx, '/api/browser/pair', 'POST', undefined, 'null');
  assert.deepEqual(result.value, { paired: true });
  assert.deepEqual(fx.redeemed, [{ code: '', extensionId: '', profileId: '', profileName: '' }]);
});

test('unpair returns the service result or maps its failure fields', async () => {
  const removed: string[] = [];
  const ok = browser(async (id) => (removed.push(id), { removed: id }));
  const success = await call(ok, '/api/browser/pairings/pair%201', 'DELETE');
  assert.deepEqual([success.status, success.value], [200, { removed: 'pair 1' }]);
  assert.deepEqual(removed, ['pair 1']);

  const bare = browser(async () => {
    throw {};
  });
  const failed = await call(bare, '/api/browser/pairings/p2', 'DELETE');
  assert.equal(failed.status, 500);
  assert.deepEqual(failed.value.error, {
    code: 'BROWSER_PAIRING_REMOVE_FAILED',
    message: 'Browser pairing could not be removed',
  });
  const coded = browser(async () => {
    throw { status: 404, code: 'PAIRING_NOT_FOUND', message: 'gone' };
  });
  const missing = await call(coded, '/api/browser/pairings/p3', 'DELETE');
  assert.deepEqual([missing.status, missing.value.error.code], [404, 'PAIRING_NOT_FOUND']);
  assert.equal((await call(coded, '/api/browser/pairings/p3', 'GET')).handled, false);
});

test('revoke-all delegates to the pairing service', async () => {
  const fx = browser(async () => ({}));
  assert.deepEqual((await call(fx, '/api/browser/revoke', 'POST')).value, { epoch: 2 });
});

test('origin policy GET and POST handle missing and failing policy services', async () => {
  const fx = browser(async () => ({}));
  const none = await call(fx, '/api/browser/policy');
  assert.deepEqual([none.status, none.value], [200, null]);
  const unwired = await call(fx, '/api/browser/policy', 'POST', {});
  assert.deepEqual([unwired.status, unwired.value.error.code], [503, 'BROWSER_UNAVAILABLE']);
  const empty = await call(
    { ...fx, browserPolicy: { snapshot: () => undefined } },
    '/api/browser/policy',
  );
  assert.deepEqual([empty.status, empty.value], [200, null]);

  const updates: unknown[] = [];
  let fail: unknown;
  const browserPolicy = {
    snapshot: () => ({ mode: 'normal' }),
    update: (input: unknown) => {
      updates.push(input);
      if (fail) throw fail;
    },
  };
  const context = { ...fx, browserPolicy };
  const saved = await call(context, '/api/browser/policy', 'POST', undefined, 'null');
  assert.deepEqual([saved.status, saved.value], [200, { mode: 'normal' }]);
  assert.deepEqual(updates, [{}]);
  fail = {};
  const bare = await call(context, '/api/browser/policy', 'POST', { rules: 1 });
  assert.deepEqual(bare.value.error, {
    code: 'ORIGIN_POLICY_INVALID',
    message: 'Invalid origin policy',
  });
  fail = { code: 'ORIGIN_TOO_BROAD', message: 'too broad' };
  const coded = await call(context, '/api/browser/policy', 'POST', { rules: 2 });
  assert.deepEqual([coded.status, coded.value.error.code], [400, 'ORIGIN_TOO_BROAD']);
  assert.equal((await call(context, '/api/browser/code', 'GET')).handled, false);
});
