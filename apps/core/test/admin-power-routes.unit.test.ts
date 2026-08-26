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

async function call(method: string, value: unknown, context: any) {
  const res = response();
  const handled = await handleAdminApi(
    request(method, value),
    res,
    new URL('https://localhost/api/power/keep-awake'),
    context,
  );
  return { handled, status: res.statusCode, body: res.body ? JSON.parse(res.body) : undefined };
}

test('power keep-awake GET returns current runtime status through Admin routing', async () => {
  const expected = {
    mode: 'remote-connections',
    active: true,
    supported: true,
    platform: 'win32',
    reason: '1 remote connection',
    remoteConnections: 1,
    managedProcesses: 0,
  };
  const result = await call('GET', undefined, { power: { status: () => expected } });

  assert.equal(result.handled, true);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, expected);
});

test('power keep-awake PATCH validates mode and refreshes immediately', async () => {
  const modes: string[] = [];
  const result = await call(
    'PATCH',
    { mode: 'managed-processes' },
    {
      power: {
        status: () => ({}),
        async configure(mode: string) {
          modes.push(mode);
          return {
            mode,
            active: true,
            supported: true,
            platform: 'linux',
            reason: '2 managed processes',
            remoteConnections: 0,
            managedProcesses: 2,
          };
        },
      },
    },
  );

  assert.deepEqual(modes, ['managed-processes']);
  assert.equal(result.status, 200);
  assert.equal(result.body.mode, 'managed-processes');
  assert.equal(result.body.active, true);
});

test('power keep-awake PATCH rejects invalid modes without configuring', async () => {
  let configured = false;
  const result = await call(
    'PATCH',
    { mode: 'sleep-forever' },
    {
      power: {
        status: () => ({}),
        async configure() {
          configured = true;
          return {};
        },
      },
    },
  );

  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, 'INVALID_KEEP_AWAKE_MODE');
  assert.equal(configured, false);
});
