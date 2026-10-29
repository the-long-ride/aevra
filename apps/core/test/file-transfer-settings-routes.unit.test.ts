import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleFileTransferSettingsRoutes } from '../src/admin/routes/file-transfer-settings-routes.js';
import {
  normalizeTransferLimits,
  transferLimitBytes,
} from '../../../packages/protocol/src/file-transfer.js';

function fixture() {
  const values = new Map<string, any>();
  return {
    values,
    context: {
      settings: {
        get: (key: string, fallback: unknown) => (values.has(key) ? values.get(key) : fallback),
        set: (key: string, value: unknown) => values.set(key, value),
        revision: () => 3,
      },
    } as any,
  };
}

async function call(
  fx: ReturnType<typeof fixture>,
  method: string,
  body?: unknown,
  path = '/api/files/transfer-settings',
) {
  const text = body === undefined ? '' : JSON.stringify(body);
  const req = Readable.from(text ? [Buffer.from(text)] : []) as any;
  req.method = method;
  req.headers = {};
  const res: any = {
    statusCode: 0,
    body: '',
    setHeader() {},
    end(value = '') {
      res.body = String(value);
    },
  };
  const handled = await handleFileTransferSettingsRoutes(
    req,
    res,
    new URL(`https://localhost${path}`),
    fx.context,
  );
  return { handled, status: res.statusCode, value: res.body ? JSON.parse(res.body) : undefined };
}

test('GET returns defaults', async () => {
  const got = await call(fixture(), 'GET');
  assert.deepEqual(got.value, { maxFileMb: 200, maxBatchMb: 500, inlineMb: 50 });
});

test('PATCH clamps and orders limits', async () => {
  const fx = fixture();
  const low = await call(fx, 'PATCH', { maxFileMb: 0 });
  assert.equal(low.value.value.maxFileMb, 1);
  assert.equal(low.value.value.inlineMb, 1);
  const inline = await call(fx, 'PATCH', { inlineMb: 900, maxFileMb: 200 });
  assert.deepEqual(inline.value.value, { maxFileMb: 200, maxBatchMb: 500, inlineMb: 200 });
  assert.deepEqual(fx.values.get('files.transfer'), inline.value.value);
  const high = await call(fx, 'PATCH', { maxBatchMb: 99999 });
  assert.equal(high.value.value.maxBatchMb, 10240);
});

test('PATCH caps maxFileMb down to the batch limit', async () => {
  const fx = fixture();
  const got = await call(fx, 'PATCH', { maxFileMb: 900 });
  assert.deepEqual(got.value.value, { maxFileMb: 500, maxBatchMb: 500, inlineMb: 50 });
  assert.equal(fx.values.get('files.transfer').maxFileMb, 500);
});

test('PATCH rejects non-object bodies and unsupported methods; other paths pass', async () => {
  const fx = fixture();
  assert.equal((await call(fx, 'PATCH', 'x')).status, 400);
  assert.equal((await call(fx, 'PATCH', [1])).status, 400);
  assert.equal((await call(fx, 'DELETE')).status, 405);
  assert.equal((await call(fx, 'GET', undefined, '/api/other')).handled, false);
});

test('normalize tolerates junk and transferLimitBytes converts MB', () => {
  assert.deepEqual(normalizeTransferLimits(null), {
    maxFileMb: 200,
    maxBatchMb: 500,
    inlineMb: 50,
  });
  assert.deepEqual(normalizeTransferLimits({ maxFileMb: 'abc', inlineMb: '', maxBatchMb: 7.9 }), {
    maxFileMb: 7,
    maxBatchMb: 7,
    inlineMb: 7,
  });
  assert.deepEqual(transferLimitBytes({ maxFileMb: 2, maxBatchMb: 3, inlineMb: 1 }), {
    file: 2097152,
    batch: 3145728,
    inline: 1048576,
  });
});
