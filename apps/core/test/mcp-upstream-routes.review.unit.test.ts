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
  await handleAdminApi(request(method, value), res, new URL(`https://localhost${path}`), context);
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : undefined };
}
function upstreamRecord() {
  return {
    id: 'u1',
    name: 'github',
    transport: 'http',
    config: { url: 'https://mcp.example.com/mcp' },
    auth: null,
    risk: 'HIGH',
    enabled: true,
    state: 'active',
    toolCount: 2,
    resourceCount: 0,
    promptCount: 0,
    catalogFingerprint: 'abc',
    pendingCatalogDiff: null,
    advisory: [],
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
  };
}
function fakeRegistry(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ method: string }> = [];
  return {
    calls,
    async list() {
      calls.push({ method: 'list' });
      return [upstreamRecord()];
    },
    async acknowledge() {
      calls.push({ method: 'acknowledge' });
      return upstreamRecord();
    },
    ...overrides,
  };
}
function auditSpy() {
  const events: any[] = [];
  return { events, append: (event: unknown) => events.push(event) };
}

test('list runs reconcile before listing', async () => {
  const registry = fakeRegistry();
  (registry as any).reconcileForList = async () => {
    registry.calls.push({ method: 'reconcileForList' });
  };
  const result = await call('GET', '/api/mcp/upstreams', undefined, { mcpUpstreams: registry });
  assert.equal(result.status, 200);
  assert.deepEqual(
    registry.calls.map((entry) => entry.method),
    ['reconcileForList', 'list'],
  );
});
test('list still returns when reconcile rejects', async () => {
  const result = await call('GET', '/api/mcp/upstreams', undefined, {
    mcpUpstreams: fakeRegistry({
      async reconcileForList() {
        throw new Error('worker unreachable');
      },
    }),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.upstreams.length, 1);
});
test('acknowledge writes audit event', async () => {
  const audit = auditSpy();
  const result = await call(
    'POST',
    '/api/mcp/upstreams/u1/acknowledge',
    { expectedFingerprint: 'abc' },
    { mcpUpstreams: fakeRegistry(), audit },
  );
  assert.equal(result.status, 200);
  assert.deepEqual(audit.events, [
    {
      actor: 'admin',
      operation: 'mcp.upstream.acknowledge',
      target: 'github',
      result: 'ok',
      redactionCount: 0,
      class: 'normal',
    },
  ]);
});
test('failed acknowledge writes no audit event', async () => {
  const audit = auditSpy();
  const result = await call(
    'POST',
    '/api/mcp/upstreams/u1/acknowledge',
    { expectedFingerprint: 'abc' },
    {
      mcpUpstreams: fakeRegistry({
        async acknowledge() {
          throw Object.assign(new Error('catalog changed'), {
            code: 'MCP_UPSTREAM_CATALOG_CHANGED',
          });
        },
      }),
      audit,
    },
  );
  assert.equal(result.status, 409);
  assert.equal(audit.events.length, 0);
});
