import assert from 'node:assert/strict';
import test from 'node:test';
import { McpIngressServer } from '../src/mcp/server.js';

const identity = {
  actor: 'test:modern',
  subject: 'modern-client',
  issuer: 'test',
  audience: 'aevra',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

function runtimeFixture() {
  const sessions = new Map<string, any>();
  const calls: Array<{ sessionId: string; name: string; args: any }> = [];
  return {
    sessions,
    calls,
    runtime: {
      sessions: {
        create(remoteIdentity: any) {
          const session = { id: `modern-session-${sessions.size + 1}`, ...remoteIdentity };
          sessions.set(session.id, session);
          return session;
        },
        getOrCreateForIdentity(remoteIdentity: any) {
          const existing = [...sessions.values()].find(
            (session) =>
              session.actor === remoteIdentity.actor && session.subject === remoteIdentity.subject,
          );
          if (existing) return { session: existing, created: false };
          const session = {
            id: `modern-session-${sessions.size + 1}`,
            ...remoteIdentity,
          };
          sessions.set(session.id, session);
          return { session, created: true };
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
        async call(sessionId: string, name: string, args: any) {
          calls.push({ sessionId, name, args });
          return { ok: true, sessionId, name, args };
        },
      },
    } as any,
  };
}

function modernHeaders(method: string, name?: string) {
  return {
    'content-type': 'application/json',
    'mcp-protocol-version': '2026-07-28',
    'mcp-method': method,
    ...(name ? { 'mcp-name': name } : {}),
  };
}

function modernBody(method: string, params: Record<string, any> = {}) {
  return {
    jsonrpc: '2.0',
    id: `${method}-1`,
    method,
    params: {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name: 'modern-test', version: '1' },
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    },
  };
}

async function withServer(
  run: (server: McpIngressServer, fixture: ReturnType<typeof runtimeFixture>) => Promise<void>,
) {
  const fixture = runtimeFixture();
  const verifier: any = {
    async verifyRequest() {
      return identity;
    },
  };
  const server = new McpIngressServer(
    '127.0.0.1',
    0,
    verifier,
    undefined,
    () => false,
    fixture.runtime,
  );
  await server.start();
  try {
    await run(server, fixture);
  } finally {
    await server.close();
  }
}

test('modern tools/list is stateless at the MCP transport boundary', async () => {
  await withServer(async (server) => {
    const response = await fetch(`${server.url()}/mcp`, {
      method: 'POST',
      headers: modernHeaders('tools/list'),
      body: JSON.stringify(modernBody('tools/list')),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('mcp-session-id'), null);
    const value = (await response.json()) as any;
    assert.ok(value.result.tools.length > 0);
    assert.equal(value.result.cacheScope, 'private');
    assert.ok(value.result.ttlMs > 0);
    assert.equal(value.result._meta['io.modelcontextprotocol/serverInfo'].name, 'Aevra');
  });
});

test('modern tools/call reuses internal security state without exposing a protocol session', async () => {
  await withServer(async (server, fixture) => {
    for (let index = 0; index < 2; index += 1) {
      const response = await fetch(`${server.url()}/mcp`, {
        method: 'POST',
        headers: modernHeaders('tools/call', 'test_tool'),
        body: JSON.stringify(modernBody('tools/call', { name: 'test_tool', arguments: { index } })),
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('mcp-session-id'), null);
    }
    assert.equal(fixture.calls.length, 2);
    assert.equal(fixture.calls[0]!.sessionId, fixture.calls[1]!.sessionId);
    assert.equal(fixture.sessions.size, 1);
  });
});

test('modern request rejects missing or mismatched Mcp-Method', async () => {
  await withServer(async (server) => {
    for (const headers of [
      { 'content-type': 'application/json', 'mcp-protocol-version': '2026-07-28' },
      modernHeaders('resources/list'),
    ]) {
      const response = await fetch(`${server.url()}/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify(modernBody('tools/list')),
      });
      assert.equal(response.status, 400);
      const value = (await response.json()) as any;
      assert.equal(value.error.code, -32020);
    }
  });
});

test('modern named request rejects mismatched Mcp-Name', async () => {
  await withServer(async (server) => {
    const response = await fetch(`${server.url()}/mcp`, {
      method: 'POST',
      headers: modernHeaders('tools/call', 'wrong_tool'),
      body: JSON.stringify(modernBody('tools/call', { name: 'test_tool', arguments: {} })),
    });
    assert.equal(response.status, 400);
    const value = (await response.json()) as any;
    assert.equal(value.error.code, -32020);
  });
});

test('unknown protocol revision returns modern unsupported-version error', async () => {
  await withServer(async (server) => {
    const response = await fetch(`${server.url()}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'mcp-protocol-version': '2099-01-01' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(response.status, 400);
    const value = (await response.json()) as any;
    assert.equal(value.error.code, -32022);
    assert.equal(value.error.data.requested, '2099-01-01');
    assert.ok(value.error.data.supported.includes('2026-07-28'));
  });
});
