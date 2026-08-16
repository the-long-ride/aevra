import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { SessionRepository } from '../../../packages/store/src/sessions.js';
import { handleJsonRpc } from '../../../packages/mcp-tools/src/register.js';
import { CapabilityProfileService } from '../src/policy/capabilities.js';
import { SessionManager } from '../src/sessions/session-manager.js';
import { McpIngressServer } from '../src/mcp/server.js';

const identity = {
  subject: 'modern-hardening',
  actor: 'oauth:ChatGPT',
  issuer: 'test',
  audience: 'aevra',
  expiresAt: '2099-01-01T00:00:00.000Z',
};

test('SessionManager exposes identity-bound get-or-create semantics', () => {
  const db = AevraDatabase.open(':memory:');
  const manager = new SessionManager(
    new SessionRepository(db.raw()),
    new CapabilityProfileService(db.raw()),
  );
  assert.equal(typeof (manager as any).getOrCreateForIdentity, 'function');
  const first = (manager as any).getOrCreateForIdentity(identity, '127.0.0.1');
  const second = (manager as any).getOrCreateForIdentity(identity, '127.0.0.2');
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.session.id, second.session.id);
  const other = (manager as any).getOrCreateForIdentity({ ...identity, subject: 'other' });
  assert.notEqual(other.session.id, first.session.id);
  db.close();
});

test('MCP 2026 tools/call preserves arbitrary JSON structured content', async () => {
  const response = await handleJsonRpc(
    {
      async call() {
        return ['alpha', 7, null];
      },
    } as any,
    'session',
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'test_tool', arguments: {} },
    },
    '2026-07-28',
  );
  assert.deepEqual(response.result.structuredContent, ['alpha', 7, null]);
});

test('unsupported server/discover revision returns -32022', async () => {
  const sessions = new Map<string, any>();
  const server = new McpIngressServer(
    '127.0.0.1',
    0,
    {
      async verifyRequest() {
        return identity;
      },
    } as any,
    undefined,
    () => false,
    {
      sessions: {
        create(value: any) {
          const session = { id: 'session-1', ...value };
          sessions.set(session.id, session);
          return session;
        },
        get(id: string) {
          return sessions.get(id);
        },
        list() {
          return [...sessions.values()];
        },
        touch() {},
      },
      service: {
        async call() {
          return {};
        },
      },
    } as any,
  );
  await server.start();
  try {
    const response = await fetch(`${server.url()}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'mcp-protocol-version': '2099-01-01',
        'mcp-method': 'server/discover',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'server/discover',
        params: {
          _meta: { 'io.modelcontextprotocol/protocolVersion': '2099-01-01' },
        },
      }),
    });
    assert.equal(response.status, 400);
    const value = (await response.json()) as any;
    assert.equal(value.error.code, -32022);
    assert.equal(value.error.data.requested, '2099-01-01');
  } finally {
    await server.close();
  }
});
