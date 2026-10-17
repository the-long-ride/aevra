import assert from 'node:assert/strict';
import http, { type IncomingHttpHeaders } from 'node:http';
import { Readable } from 'node:stream';
import test from 'node:test';
import { AdminServer } from '../src/admin/server.js';
import { PublicGateway } from '../src/gateway/public-gateway.js';
import { failRequest, guardListener } from '../src/mcp/listener-guards.js';
import { handleOAuthRoute } from '../src/mcp/oauth-routes.js';
import { McpIngressServer } from '../src/mcp/server.js';

const TRUST_PHRASE = 'gateway trust phrase';

interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function send(
  port: number,
  path: string,
  headers: Record<string, string> = {},
  method = 'GET',
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, path, method, headers, agent: false },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    request.once('error', reject);
    request.end();
  });
}

function portOf(server: { address(): unknown }) {
  return (server.address() as { port: number }).port;
}

async function withAdmin(
  run: (port: number) => Promise<void>,
  health: () => unknown = () => ({ core: 'running' }),
) {
  const server = new AdminServer('127.0.0.1', 0, health, {
    bootstrap: { validateSession: (value?: string) => value === 'live' } as any,
    trustedOrigins: () => ['https://admin.example.com'],
    gatewayTrustSecret: TRUST_PHRASE,
  });
  await server.start();
  try {
    await run(portOf(server));
  } finally {
    await server.close();
  }
}

test('admin listener answers 400 to malformed request targets and keeps serving', async () => {
  await withAdmin(async (port) => {
    for (const target of ['//', '/\\', '//evil.example/api/health', 'http://evil.example/']) {
      const response = await send(port, target);
      assert.equal(response.status, 400, target);
    }
    assert.equal((await send(port, '/api/health')).status, 200);
  });
});

test('admin listener treats a malformed session cookie as signed out', async () => {
  await withAdmin(async (port) => {
    const response = await send(port, '/api/status', { cookie: 'aevra_admin=%' });
    assert.equal(response.status, 401);
    assert.equal((await send(port, '/api/health')).status, 200);
  });
});

test('unauthenticated health exposes only core and version', async () => {
  const health = () => ({
    core: 'running',
    version: '1.2.3',
    exposure: { provider: 'cloudflare', publicUrl: 'https://tunnel.example.com' },
    mcpDiagnostics: { lastActor: 'someone' },
    connectorFailedAttempts: 4,
    safeMode: false,
  });
  await withAdmin(async (port) => {
    const response = await send(port, '/api/health');
    assert.deepEqual(JSON.parse(response.body), { core: 'running', version: '1.2.3' });
    const status = await send(port, '/api/status', { cookie: 'aevra_admin=live' });
    assert.equal(JSON.parse(status.body).connectorFailedAttempts, 4);
  }, health);
});

test('admin responses forbid framing', async () => {
  await withAdmin(async (port) => {
    for (const path of ['/api/health', '/', '/api/status']) {
      const response = await send(port, path);
      assert.equal(response.headers['content-security-policy'], "frame-ancestors 'none'");
      assert.equal(response.headers['x-frame-options'], 'DENY');
    }
  });
});

test('admin refuses a Host outside the allow-list with 421', async () => {
  await withAdmin(async (port) => {
    assert.equal((await send(port, '/api/health', { host: 'rebind.example' })).status, 421);
    assert.equal((await send(port, '/api/health', { host: 'evil.example:80' })).status, 421);
    for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]) {
      assert.equal((await send(port, '/api/health', { host })).status, 200, host);
    }
    assert.equal((await send(port, '/api/health', { host: 'admin.example.com' })).status, 200);
  });
});

test('loopback exemptions do not cover requests proxied by the gateway', async () => {
  await withAdmin(async (port) => {
    const viaGateway = { 'x-aevra-gateway-trust': TRUST_PHRASE };
    const pair = await send(port, '/api/browser/pair', viaGateway, 'POST');
    assert.equal(pair.status, 401);
    assert.notEqual((await send(port, '/api/browser/pair', {}, 'POST')).status, 401);

    const session = { cookie: 'aevra_admin=live' };
    const proxied = await send(port, '/api/nothing', { ...session, ...viaGateway }, 'POST');
    assert.equal(proxied.status, 403);
    assert.equal((await send(port, '/api/nothing', session, 'POST')).status, 404);
  });
});

test('MCP listener answers 400 to malformed request targets and keeps serving', async () => {
  const server = new McpIngressServer('127.0.0.1', 0);
  await server.start();
  try {
    for (const target of ['//', '/\\', '//evil.example/mcp']) {
      assert.equal((await send(portOf(server), target)).status, 400, target);
    }
    assert.equal((await send(portOf(server), '/health')).status, 200);
  } finally {
    await server.close();
  }
});

test('OAuth revoke with a malformed JSON body is an invalid_request, not a crash', async () => {
  const stream = Readable.from([Buffer.from('{broken')]) as any;
  stream.method = 'POST';
  stream.headers = { 'content-type': 'application/json' };
  stream.socket = { remoteAddress: '10.1.1.1' };
  const result = { statusCode: 0, body: '', headers: {} as Record<string, string> };
  const res = {
    ...result,
    setHeader(key: string, value: string) {
      res.headers[key.toLowerCase()] = value;
    },
    end(value = '') {
      res.body = String(value);
    },
  } as any;
  let revoked = false;
  const handled = await handleOAuthRoute(stream, res, new URL('https://localhost/oauth/revoke'), {
    revoke: () => (revoked = true),
  } as any);
  assert.equal(handled, true);
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, 'invalid_request');
  assert.equal(revoked, false);
});

function fakeResponse(headersSent = false) {
  const res = {
    headersSent,
    writableEnded: false,
    destroyed: false,
    statusCode: 0,
    body: '',
    setHeader() {},
    end(value = '') {
      res.body = String(value);
      res.writableEnded = true;
    },
    destroy() {
      res.destroyed = true;
    },
  };
  return res;
}

test('a rejected listener handler becomes a 500, keeps 4xx, or drops a started response', async () => {
  const failing = fakeResponse();
  guardListener(async () => {
    throw new Error('boom');
  })({} as any, failing as any);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(failing.statusCode, 500);

  const client = fakeResponse();
  failRequest(client as any, Object.assign(new Error('bad'), { status: 413 }));
  assert.equal(client.statusCode, 413);

  const started = fakeResponse(true);
  failRequest(started as any, new Error('late'));
  assert.equal(started.destroyed, true);
});

test('gateway refuses malformed targets and forbids framing of admin responses', async () => {
  const upstream = http.createServer((_req, res) => res.end('ok'));
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${portOf(upstream)}`;
  const gateway = new PublicGateway({
    host: '127.0.0.1',
    port: 0,
    protocol: 'http',
    targets: { adminUrl: base, mcpUrl: base },
  });
  await gateway.start();
  try {
    const port = portOf(gateway);
    assert.equal((await send(port, '//')).status, 400);
    assert.equal((await send(port, '/\\evil')).status, 400);
    const admin = await send(port, '/');
    assert.equal(admin.status, 200);
    assert.equal(admin.headers['x-frame-options'], 'DENY');
    assert.equal(admin.headers['content-security-policy'], "frame-ancestors 'none'");
    const mcp = await send(port, '/health');
    assert.equal(mcp.headers['x-frame-options'], undefined);
  } finally {
    await gateway.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});
