import assert from 'node:assert/strict';
import test from 'node:test';
import { McpIngressServer } from '../src/mcp/server.js';

const identity = {
  actor: 'test:chatgpt',
  subject: 'chatgpt',
  issuer: 'test',
  audience: 'aevra',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

function runtimeFixture() {
  const sessions = new Map<string, any>();
  return {
    sessions,
    runtime: {
      sessions: {
        create() {
          const session = { id: `session-${sessions.size + 1}`, ...identity };
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
        disconnect(id: string) {
          sessions.delete(id);
        },
      },
      service: {},
    } as any,
  };
}

function oauthFixture() {
  return {
    issuer: 'https://mcp.example.com',
    resource: 'https://mcp.example.com/mcp',
    verifyAccessToken(token: string) {
      if (token !== 'valid-token') throw new Error('invalid token');
      return identity;
    },
    protectedResourceMetadata() {
      return {
        resource: 'https://mcp.example.com/mcp',
        authorization_servers: ['https://mcp.example.com'],
      };
    },
    authorizationServerMetadata() {
      return {
        issuer: 'https://mcp.example.com',
        authorization_endpoint: 'https://mcp.example.com/oauth/authorize',
        token_endpoint: 'https://mcp.example.com/oauth/token',
      };
    },
  } as any;
}

const authHeaders = { authorization: 'Bearer valid-token', 'content-type': 'application/json' };

test('MCP notifications/initialized is accepted without an invalid JSON-RPC response', async () => {
  const { runtime } = runtimeFixture();
  const verifier: any = {
    async verifyRequest() {
      return identity;
    },
  };
  const server = new McpIngressServer('127.0.0.1', 0, verifier, undefined, () => false, runtime);
  await server.start();
  try {
    const init = await fetch(`${server.url()}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'ChatGPT', version: '1' },
        },
      }),
    });
    assert.equal(init.status, 200);
    const sessionId = init.headers.get('mcp-session-id');
    assert.equal(sessionId, 'session-1');
    const initialized = await fetch(`${server.url()}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'mcp-session-id': sessionId! },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    assert.equal(initialized.status, 202);
    assert.equal(await initialized.text(), '');
  } finally {
    await server.close();
  }
});

test('OAuth discovery responses are explicitly non-cacheable', async () => {
  const oauth = oauthFixture();
  const server = new McpIngressServer(
    '127.0.0.1',
    0,
    undefined,
    undefined,
    () => false,
    undefined,
    undefined,
    { oauth },
  );
  await server.start();
  try {
    for (const path of [
      '/.well-known/oauth-protected-resource/mcp',
      '/.well-known/oauth-authorization-server',
    ]) {
      const response = await fetch(`${server.url()}${path}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  } finally {
    await server.close();
  }
});

test('post-OAuth modern MCP discovery succeeds without a protocol session', async () => {
  const { runtime } = runtimeFixture();
  const server = new McpIngressServer(
    '127.0.0.1',
    0,
    undefined,
    undefined,
    () => false,
    runtime,
    undefined,
    { oauth: oauthFixture() },
  );
  await server.start();
  try {
    const response = await fetch(`${server.url()}/mcp`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'server/discover',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'discover-1',
        method: 'server/discover',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'ChatGPT', version: '1' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('mcp-session-id'), null);
    const value = (await response.json()) as any;
    assert.deepEqual(value?.result?.supportedVersions, ['2026-07-28']);
    assert.equal(value?.result?._meta?.['io.modelcontextprotocol/serverInfo']?.name, 'Aevra');
    assert.deepEqual(value?.result?._meta?.['io.modelcontextprotocol/serverInfo']?.icons, [
      { src: 'https://mcp.example.com/aevra-logo.png', mimeType: 'image/png' },
    ]);
  } finally {
    await server.close();
  }
});

test('authenticated legacy MCP session errors use transport status codes instead of OAuth 401', async () => {
  const { runtime } = runtimeFixture();
  const server = new McpIngressServer(
    '127.0.0.1',
    0,
    undefined,
    undefined,
    () => false,
    runtime,
    undefined,
    { oauth: oauthFixture() },
  );
  await server.start();
  try {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const missing = await fetch(`${server.url()}/mcp`, {
      method: 'POST',
      headers: { ...authHeaders, 'mcp-protocol-version': '2025-11-25' },
      body,
    });
    assert.equal(
      missing.status,
      400,
      'missing MCP session is a bad MCP request, not failed authentication',
    );
    const unknown = await fetch(`${server.url()}/mcp`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'mcp-protocol-version': '2025-11-25',
        'mcp-session-id': 'expired-session',
      },
      body,
    });
    assert.equal(
      unknown.status,
      404,
      'expired/unknown MCP session must cause MCP reinitialization, not OAuth reauthentication',
    );
  } finally {
    await server.close();
  }
});

test('OAuth bearer remains valid through initialize and tools/list discovery', async () => {
  const { runtime } = runtimeFixture();
  const server = new McpIngressServer(
    '127.0.0.1',
    0,
    undefined,
    undefined,
    () => false,
    runtime,
    undefined,
    { oauth: oauthFixture() },
  );
  await server.start();
  try {
    const init = await fetch(`${server.url()}/mcp`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'ChatGPT', version: '1' },
        },
      }),
    });
    assert.equal(init.status, 200);
    const initResult = (await init.json()) as any;
    assert.deepEqual(initResult?.result?.serverInfo?.icons, [
      { src: 'https://mcp.example.com/aevra-logo.png', mimeType: 'image/png' },
    ]);
    const sid = init.headers.get('mcp-session-id');
    assert.ok(sid);
    const tools = await fetch(`${server.url()}/mcp`, {
      method: 'POST',
      headers: { ...authHeaders, 'mcp-protocol-version': '2025-11-25', 'mcp-session-id': sid },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    assert.equal(tools.status, 200);
    const result = (await tools.json()) as any;
    assert.ok(result?.result?.tools?.length > 0);
  } finally {
    await server.close();
  }
});
