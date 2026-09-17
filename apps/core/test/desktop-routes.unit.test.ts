import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleAdminApi } from '../src/admin/routes/api.js';
import { DesktopPolicyService } from '../src/desktop/desktop-policy-service.js';

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

async function call(method: string, path: string, value: unknown, context: any) {
  const res = response();
  const handled = await handleAdminApi(
    request(method, value),
    res,
    new URL(`https://localhost${path}`),
    context,
  );
  return { handled, status: res.statusCode, body: res.body ? JSON.parse(res.body) : undefined };
}

function fakeSettings() {
  const store = new Map<string, unknown>();
  return {
    get: <T>(key: string, fallback: T): T => (store.has(key) ? (store.get(key) as T) : fallback),
    set: (key: string, value: unknown) => void store.set(key, value),
  };
}

test('GET /api/desktop/policy reports the current policy', async () => {
  const context = { desktopPolicy: new DesktopPolicyService(fakeSettings()) };
  const result = await call('GET', '/api/desktop/policy', undefined, context);
  assert.equal(result.status, 200);
  assert.equal(result.body.mode, 'denylist');
});

test('POST /api/desktop/policy updates the mode and application list', async () => {
  const context = { desktopPolicy: new DesktopPolicyService(fakeSettings()) };
  const result = await call(
    'POST',
    '/api/desktop/policy',
    { mode: 'allowlist', applications: ['notepad.exe'] },
    context,
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.mode, 'allowlist');
  assert.deepEqual(result.body.applications, ['notepad.exe']);
});

test('POST /api/desktop/policy with an invalid mode reports 400', async () => {
  const context = { desktopPolicy: new DesktopPolicyService(fakeSettings()) };
  const result = await call('POST', '/api/desktop/policy', { mode: 'open-season' }, context);
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, 'DESKTOP_POLICY_INVALID');
});

test('desktop policy routes report unavailable when desktop control is not wired', async () => {
  const result = await call('GET', '/api/desktop/policy', undefined, {});
  assert.equal(result.status, 503);
  assert.equal(result.body.error.code, 'DESKTOP_UNAVAILABLE');
});

test('GET /api/desktop/apps returns an array even with no desktopPolicy wired', async () => {
  const result = await call('GET', '/api/desktop/apps', undefined, {});
  assert.equal(result.status, 200);
  assert.ok(Array.isArray(result.body.apps));
});

test('an unsupported method on a desktop route is not handled here', async () => {
  const context = { desktopPolicy: new DesktopPolicyService(fakeSettings()) };
  const result = await call('DELETE', '/api/desktop/policy', undefined, context);
  assert.equal(result.handled, false);
});
