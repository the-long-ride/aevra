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
function upstreamRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    name: 'github',
    transport: 'http',
    config: { url: 'https://mcp.example.com/mcp' },
    auth: { kind: 'header', header: 'Authorization', secretRefId: 'sr_github' },
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
    ...overrides,
  };
}
function fakeRegistry(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  return {
    calls,
    async list() {
      calls.push({ method: 'list', args: [] });
      return [upstreamRecord()];
    },
    async create(input: unknown) {
      calls.push({ method: 'create', args: [input] });
      return upstreamRecord();
    },
    async update(id: string, input: unknown) {
      calls.push({ method: 'update', args: [id, input] });
      return upstreamRecord();
    },
    async remove(id: string) {
      calls.push({ method: 'remove', args: [id] });
    },
    async test(id: string) {
      calls.push({ method: 'test', args: [id] });
      return {
        ok: true,
        serverName: 'github-mcp',
        serverVersion: '1.2.3',
        toolCount: 2,
        resourceCount: 0,
        promptCount: 0,
        state: 'active',
        message: null,
      };
    },
    async acknowledge(id: string) {
      calls.push({ method: 'acknowledge', args: [id] });
      return upstreamRecord({ state: 'active', pendingCatalogDiff: null });
    },
    ...overrides,
  };
}

test('GET lists registered servers', async () => {
  const result = await call('GET', '/api/mcp/upstreams', undefined, {
    mcpUpstreams: fakeRegistry(),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.upstreams[0].name, 'github');
  assert.equal(result.body.upstreams[0].toolCount, 2);
});
test('POST registers a server and answers 201', async () => {
  const registry = fakeRegistry();
  const result = await call(
    'POST',
    '/api/mcp/upstreams',
    {
      name: 'github',
      transport: 'http',
      config: { url: 'https://mcp.example.com/mcp' },
      auth: { header: 'Authorization', secretRefId: 'sr_github' },
      risk: 'HIGH',
    },
    { mcpUpstreams: registry },
  );
  assert.equal(result.status, 201);
  assert.equal(result.body.name, 'github');
  assert.equal(registry.calls[0]!.method, 'create');
});
test('bad input never reaches the service', async () => {
  const registry = fakeRegistry();
  const result = await call(
    'POST',
    '/api/mcp/upstreams',
    { name: 'My Server', transport: 'http', config: { url: 'https://x.test/mcp' }, risk: 'LOW' },
    { mcpUpstreams: registry },
  );
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, 'UPSTREAM_NAME_INVALID');
  assert.deepEqual(registry.calls, []);
});
test('DELETE removes, test reports handshake, and acknowledge clears review', async () => {
  const registry = fakeRegistry();
  const removed = await call('DELETE', '/api/mcp/upstreams/u1', undefined, {
    mcpUpstreams: registry,
  });
  assert.deepEqual(removed.body, { ok: true });
  const tested = await call('POST', '/api/mcp/upstreams/u1/test', undefined, {
    mcpUpstreams: registry,
  });
  assert.equal(tested.body.serverName, 'github-mcp');
  const ack = await call('POST', '/api/mcp/upstreams/u1/acknowledge', undefined, {
    mcpUpstreams: registry,
  });
  assert.equal(ack.body.state, 'active');
});
test('known errors map to status and missing wiring is unavailable', async () => {
  const missing = await call('DELETE', '/api/mcp/upstreams/nope', undefined, {
    mcpUpstreams: fakeRegistry({
      async remove() {
        throw Object.assign(new Error('No such upstream'), { code: 'UPSTREAM_NOT_FOUND' });
      },
    }),
  });
  assert.equal(missing.status, 404);
  const unavailable = await call('GET', '/api/mcp/upstreams', undefined, {});
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.error.code, 'MCP_UPSTREAM_UNAVAILABLE');
});
test('unsupported methods fall through', async () => {
  const result = await call('PUT', '/api/mcp/upstreams/u1', undefined, {
    mcpUpstreams: fakeRegistry(),
  });
  assert.equal(result.handled, false);
});
