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
  return {
    status: res.statusCode,
    raw: res.body,
    body: res.body ? JSON.parse(res.body) : undefined,
  };
}
const LIVE_TOKEN = 'ghp_live_token_do_not_leak';
function contaminatedRegistry() {
  const stored: any[] = [];
  return {
    stored,
    async list() {
      return [
        {
          id: 'u1',
          name: 'github',
          transport: 'http',
          config: { url: 'https://mcp.example.com/mcp' },
          auth: { kind: 'header', header: 'Authorization', secretRefId: 'sr_github' },
          resolvedHeaderValue: `Bearer ${LIVE_TOKEN}`,
          risk: 'LOW',
          enabled: true,
          state: 'active',
          toolCount: 1,
          resourceCount: 0,
          promptCount: 0,
          catalogFingerprint: 'abc',
          pendingCatalogDiff: null,
          advisory: [{ tool: 'delete_repo', readOnlyHint: true, destructiveHint: false }],
          createdAt: '2026-09-15T00:00:00.000Z',
          updatedAt: '2026-09-15T00:00:00.000Z',
        },
      ];
    },
    async create(input: any) {
      stored.push(input);
      return { ...(await this.list())[0], ...input };
    },
    async update() {
      throw new Error('not used');
    },
    async remove() {},
    async test() {
      return {
        ok: true,
        serverName: 'github-mcp',
        serverVersion: '1',
        toolCount: 1,
        resourceCount: 0,
        promptCount: 0,
        state: 'active',
        message: null,
      };
    },
    async acknowledge() {
      return (await this.list())[0];
    },
  };
}

test('the API never returns a credential value', async () => {
  const result = await call('GET', '/api/mcp/upstreams', undefined, {
    mcpUpstreams: contaminatedRegistry(),
  });
  assert.equal(result.status, 200);
  assert.equal(result.raw.includes(LIVE_TOKEN), false);
  assert.equal(result.raw.includes('resolvedHeaderValue'), false);
  assert.equal(result.body.upstreams[0].auth.secretRefId, 'sr_github');
});
test('the API refuses a raw credential', async () => {
  const registry = contaminatedRegistry();
  const result = await call(
    'POST',
    '/api/mcp/upstreams',
    {
      name: 'github',
      transport: 'http',
      config: { url: 'https://mcp.example.com/mcp' },
      auth: { header: 'Authorization', value: `Bearer ${LIVE_TOKEN}` },
      risk: 'HIGH',
    },
    { mcpUpstreams: registry },
  );
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, 'UPSTREAM_SECRET_VALUE_REJECTED');
  assert.deepEqual(registry.stored, []);
  assert.equal(result.raw.includes(LIVE_TOKEN), false);
});
test('a handshake failure is returned and does not imply storage', async () => {
  const attempted: unknown[] = [];
  const result = await call(
    'POST',
    '/api/mcp/upstreams',
    {
      name: 'broken',
      transport: 'http',
      config: { url: 'https://unreachable.invalid/mcp' },
      risk: 'LOW',
    },
    {
      mcpUpstreams: {
        async create(input: unknown) {
          attempted.push(input);
          throw Object.assign(new Error('The upstream server did not complete initialize'), {
            code: 'UPSTREAM_HANDSHAKE_FAILED',
          });
        },
      },
    },
  );
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, 'UPSTREAM_HANDSHAKE_FAILED');
  assert.equal(attempted.length, 1);
});
test('the operator risk tier is accepted while upstream hints are ignored', async () => {
  const registry = contaminatedRegistry();
  const result = await call(
    'POST',
    '/api/mcp/upstreams',
    {
      name: 'github',
      transport: 'http',
      config: { url: 'https://mcp.example.com/mcp' },
      risk: 'CRITICAL',
      annotations: { readOnlyHint: true },
      advisory: [{ tool: 'delete_repo' }],
    },
    { mcpUpstreams: registry },
  );
  assert.equal(result.status, 201);
  assert.equal(registry.stored[0].risk, 'CRITICAL');
  assert.equal('annotations' in registry.stored[0], false);
  assert.equal('advisory' in registry.stored[0], false);
});
test('advisory hints remain display-only', async () => {
  const result = await call('GET', '/api/mcp/upstreams', undefined, {
    mcpUpstreams: contaminatedRegistry(),
  });
  assert.deepEqual(result.body.upstreams[0].advisory, [
    { tool: 'delete_repo', readOnlyHint: true, destructiveHint: false },
  ]);
  assert.equal(result.body.upstreams[0].risk, 'LOW');
});
