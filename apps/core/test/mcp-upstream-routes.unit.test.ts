import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleAdminApi } from '../src/admin/routes/api.js';

const plainPhrase1 = 'sr_github';

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
    auth: { kind: 'header', header: 'Authorization', secretRefId: plainPhrase1 },
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
    get(id: string) {
      calls.push({ method: 'get', args: [id] });
      return upstreamRecord();
    },
    async update(id: string, input: unknown) {
      calls.push({ method: 'update', args: [id, input] });
      return upstreamRecord();
    },
    async updateReporting(id: string, input: unknown) {
      const record = await (this as any).update(id, input);
      return { record, changed: record.enabled !== upstreamRecord().enabled };
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
    async setEnabled(id: string, enabled: boolean) {
      calls.push({ method: 'setEnabled', args: [id, enabled] });
      return { record: upstreamRecord({ enabled }), changed: true };
    },
    ...overrides,
  };
}
function auditSpy() {
  const events: any[] = [];
  return { events, append: (event: unknown) => events.push(event) };
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
      auth: { header: 'Authorization', secretRefId: plainPhrase1 },
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
test('POST /:id/disable returns enabled false and audits once', async () => {
  const registry = fakeRegistry();
  const audit = auditSpy();
  const result = await call('POST', '/api/mcp/upstreams/u1/disable', undefined, {
    mcpUpstreams: registry,
    audit,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.enabled, false);
  assert.deepEqual(registry.calls, [{ method: 'setEnabled', args: ['u1', false] }]);
  assert.deepEqual(audit.events, [
    {
      actor: 'admin',
      operation: 'mcp.upstream.disable',
      target: 'github',
      result: 'ok',
      redactionCount: 0,
      class: 'normal',
    },
  ]);
});
test('POST /:id/enable returns enabled true and audits once', async () => {
  const registry = fakeRegistry();
  const audit = auditSpy();
  const result = await call('POST', '/api/mcp/upstreams/u1/enable', undefined, {
    mcpUpstreams: registry,
    audit,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.enabled, true);
  assert.deepEqual(registry.calls, [{ method: 'setEnabled', args: ['u1', true] }]);
  assert.equal(audit.events.length, 1);
  assert.equal(audit.events[0].operation, 'mcp.upstream.enable');
  assert.equal(audit.events[0].class, 'normal');
});
test('a repeat disable answers 200 and adds no audit event', async () => {
  const audit = auditSpy();
  const result = await call('POST', '/api/mcp/upstreams/u1/disable', undefined, {
    mcpUpstreams: fakeRegistry({
      async setEnabled() {
        return { record: upstreamRecord({ enabled: false }), changed: false };
      },
    }),
    audit,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.enabled, false);
  assert.deepEqual(audit.events, []);
});
test('toggling works without an audit sink', async () => {
  const result = await call('POST', '/api/mcp/upstreams/u1/enable', undefined, {
    mcpUpstreams: fakeRegistry(),
  });
  assert.equal(result.status, 200);
});
test('toggling an unknown id answers 404 NOT_FOUND and audits nothing', async () => {
  const audit = auditSpy();
  const result = await call('POST', '/api/mcp/upstreams/nope/disable', undefined, {
    mcpUpstreams: fakeRegistry({
      async setEnabled() {
        throw Object.assign(new Error('No such upstream'), { code: 'NOT_FOUND', status: 404 });
      },
    }),
    audit,
  });
  assert.equal(result.status, 404);
  assert.equal(result.body.error.code, 'NOT_FOUND');
  assert.deepEqual(audit.events, []);
});
test('GET on enable and disable falls through', async () => {
  const registry = fakeRegistry();
  for (const action of ['enable', 'disable']) {
    const result = await call('GET', `/api/mcp/upstreams/u1/${action}`, undefined, {
      mcpUpstreams: registry,
    });
    assert.equal(result.handled, false);
  }
  assert.deepEqual(registry.calls, []);
});
test('an edit that flips enabled audits it; an edit that keeps it does not', async () => {
  const body = {
    name: 'github',
    transport: 'http',
    config: { url: 'https://mcp.example.com/mcp' },
    risk: 'HIGH',
  };
  const audit = auditSpy();
  const disabled = await call('POST', '/api/mcp/upstreams/u1', body, {
    mcpUpstreams: fakeRegistry({
      async update() {
        return upstreamRecord({ enabled: false });
      },
    }),
    audit,
  });
  assert.equal(disabled.body.enabled, false);
  assert.deepEqual(
    audit.events.map((event) => event.operation),
    ['mcp.upstream.disable'],
  );
  await call('POST', '/api/mcp/upstreams/u1', body, { mcpUpstreams: fakeRegistry(), audit });
  assert.equal(audit.events.length, 1);
});

test('a toggle carries the disconnect warning to the response and the audit', async () => {
  const audit = auditSpy();
  const result = await call('POST', '/api/mcp/upstreams/u1/disable', undefined, {
    mcpUpstreams: fakeRegistry({
      async setEnabled() {
        return {
          record: upstreamRecord({ enabled: false }),
          changed: true,
          warning: 'connection could not be closed',
        };
      },
    }),
    audit,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.warning, 'connection could not be closed');
  assert.equal(audit.events[0].result, 'warning');
});
test('a server cannot be added disabled', async () => {
  const registry = fakeRegistry();
  const result = await call(
    'POST',
    '/api/mcp/upstreams',
    {
      name: 'github',
      transport: 'http',
      config: { url: 'https://mcp.example.com/mcp' },
      risk: 'HIGH',
      enabled: false,
    },
    { mcpUpstreams: registry },
  );
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, 'UPSTREAM_ENABLED_INVALID');
  assert.equal(
    registry.calls.some((entry: any) => entry.method === 'create'),
    false,
  );
});
test('acting on a disabled server is a 409 conflict', async () => {
  const result = await call('POST', '/api/mcp/upstreams/u1/test', undefined, {
    mcpUpstreams: fakeRegistry({
      async test() {
        throw Object.assign(new Error('MCP_UPSTREAM_DISABLED: github is disabled'), {
          code: 'MCP_UPSTREAM_DISABLED',
        });
      },
    }),
  });
  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, 'MCP_UPSTREAM_DISABLED');
});
