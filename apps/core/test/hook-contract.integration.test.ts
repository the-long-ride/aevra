import assert from 'node:assert/strict';
import test from 'node:test';
import { McpIngressServer } from '../src/mcp/server.js';

const identity = {
  subject: 'hook-client',
  actor: 'oauth:ChatGPT',
  issuer: 'test',
  audience: 'aevra',
  expiresAt: '2099-01-01T00:00:00.000Z',
};

test('modern ingress emits guaranteed request and response hook events', async () => {
  const events: string[] = [];
  const hooks = {
    async emit(event: string, _context: unknown, payload: unknown) {
      events.push(event);
      return { payload, blocked: false, invocations: [] };
    },
  };
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
          const session = { id: 'hook-session', ...value };
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
    undefined,
    { hooks } as any,
  );
  await server.start();
  try {
    const response = await fetch(`${server.url()}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/list',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(events, [
      'request_received',
      'session_start',
      'session_connect',
      'before_response',
      'response_finished',
    ]);
  } finally {
    await server.close();
  }
});
