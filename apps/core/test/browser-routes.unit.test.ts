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

function pairing() {
  const calls: string[] = [];
  return {
    calls,
    browser: {
      state: () => ({
        extensionId: null,
        epoch: 3,
        pairedAt: null,
        pendingCode: false,
        pendingExpiresAt: null,
      }),
      createCode: () => {
        calls.push('createCode');
        return { code: 'ABCDEFGH', expiresAt: 'later' };
      },
      redeem: async (code: string, extensionId: string) => {
        calls.push(`redeem:${code}:${extensionId}`);
        return { token: 'issued', wsUrl: 'ws://127.0.0.1:47833' };
      },
      revokeAll: async () => {
        calls.push('revokeAll');
        return { extensionId: null, epoch: 4, pairedAt: null, pendingCode: false };
      },
    },
  };
}

test('GET /api/browser reports the pairing state', async () => {
  const context = pairing();
  const result = await call('GET', '/api/browser', undefined, context);
  assert.equal(result.handled, true);
  assert.equal(result.status, 200);
  assert.equal(result.body.epoch, 3);
});

test('POST /api/browser/code mints a pairing code', async () => {
  const context = pairing();
  const result = await call('POST', '/api/browser/code', {}, context);
  assert.equal(result.status, 200);
  assert.equal(result.body.code, 'ABCDEFGH');
  assert.deepEqual(context.calls, ['createCode']);
});

test('POST /api/browser/pair forwards the code and extension id', async () => {
  const context = pairing();
  const result = await call(
    'POST',
    '/api/browser/pair',
    { code: 'ABCDEFGH', extensionId: 'abcdefghijklmnopabcdefghijklmnop' },
    context,
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.wsUrl, 'ws://127.0.0.1:47833');
  assert.deepEqual(context.calls, ['redeem:ABCDEFGH:abcdefghijklmnopabcdefghijklmnop']);
});

test('POST /api/browser/revoke bumps the epoch', async () => {
  const context = pairing();
  const result = await call('POST', '/api/browser/revoke', {}, context);
  assert.equal(result.status, 200);
  assert.equal(result.body.epoch, 4);
  assert.deepEqual(context.calls, ['revokeAll']);
});

test('browser routes report unavailable when browser control is not wired', async () => {
  const result = await call('GET', '/api/browser', undefined, {});
  assert.equal(result.handled, true);
  assert.equal(result.status, 503);
  assert.equal(result.body.error.code, 'BROWSER_UNAVAILABLE');
});

test('an unsupported method on a browser route is not handled here', async () => {
  const context = pairing();
  const result = await call('DELETE', '/api/browser/code', undefined, context);
  assert.equal(result.handled, false);
});
