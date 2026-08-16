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

async function call(pathname: string, method: string, context: any, value?: unknown) {
  const res = response();
  const handled = await handleAdminApi(
    request(method, value),
    res,
    new URL(`https://localhost${pathname}`),
    context,
  );
  return {
    handled,
    status: res.statusCode,
    value: res.body ? JSON.parse(res.body) : undefined,
  };
}

test('safe mode blocks admin mutations', async () => {
  const result = await call('/api/workspaces', 'POST', { safeMode: () => true }, { name: 'x' });
  assert.equal(result.handled, true);
  assert.equal(result.status, 503);
  assert.equal(result.value.error.code, 'SAFE_MODE');
});

test('workspace list keeps current response shape', async () => {
  const result = await call('/api/workspaces', 'GET', {
    workspaces: { listLocal: () => [{ id: 'w1', name: 'Aevra' }] },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.value, [{ id: 'w1', name: 'Aevra' }]);
});

test('critical persistent permission remains forbidden', async () => {
  const result = await call(
    '/api/permissions',
    'POST',
    {
      permissions: {
        upsert() {
          throw new Error('must not persist');
        },
      },
    },
    {
      effect: 'allow',
      scope: 'global',
      matcher: 'git:push:--force',
    },
  );
  assert.equal(result.status, 400);
  assert.equal(result.value.error.code, 'CRITICAL_RULE_FORBIDDEN');
});

test('blank connector name remains invalid', async () => {
  const result = await call('/api/connectors', 'POST', { connectors: {} }, { name: '   ' });
  assert.equal(result.status, 400);
  assert.equal(result.value.error.code, 'INVALID_CONNECTOR');
});

test('onboarding state remains normalized and deduplicated', async () => {
  let stored: unknown;
  const settings = {
    set(_key: string, value: unknown) {
      stored = value;
    },
    revision: () => 9,
  };
  const result = await call(
    '/api/onboarding',
    'PATCH',
    { settings },
    {
      completed: true,
      completedSections: ['connect-ai', 'connect-ai', 3, 'workspace'],
    },
  );
  assert.equal(result.status, 200);
  assert.deepEqual(stored, {
    completed: true,
    completedSections: ['connect-ai', 'workspace'],
  });
  assert.equal(result.value.revision, 9);
});

test('unknown admin route falls through', async () => {
  const result = await call('/api/not-a-route', 'GET', {});
  assert.equal(result.handled, false);
  assert.equal(result.status, 0);
});
