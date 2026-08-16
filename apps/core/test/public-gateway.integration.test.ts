import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import https, { type Server } from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PublicGateway } from '../src/gateway/public-gateway.js';
import { ensureLocalTls } from '../src/tls/local-tls.js';

interface ResponseResult {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

async function startOrigin(
  tls: https.ServerOptions,
  name: 'admin' | 'mcp',
): Promise<{ server: Server; url: string; requests: Array<{ path: string; body: string }> }> {
  const requests: Array<{ path: string; body: string }> = [];
  const server = https.createServer(tls, async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString('utf8');
    requests.push({ path: req.url ?? '/', body });
    res.statusCode = name === 'admin' && req.url?.startsWith('/redirect') ? 302 : 200;
    res.setHeader('content-type', 'application/json');
    res.setHeader('x-origin', name);
    if (name === 'admin') {
      res.setHeader('set-cookie', 'aevra_admin=test; Secure; HttpOnly; SameSite=Strict; Path=/');
      if (req.url?.startsWith('/redirect')) res.setHeader('location', '/next');
    } else {
      res.setHeader('mcp-session-id', 'mcp-response-session');
    }
    res.end(
      JSON.stringify({
        origin: name,
        path: req.url,
        body,
        requestMcpSessionId: req.headers['mcp-session-id'] ?? null,
      }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { server, url: `https://127.0.0.1:${address.port}`, requests };
}

function request(
  gateway: PublicGateway,
  pathname: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<ResponseResult> {
  const target = new URL(pathname, gateway.url());
  return new Promise((resolve, reject) => {
    const req = https.request(
      target,
      {
        method: options.method ?? 'GET',
        headers: options.headers,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    if (options.body !== undefined) req.end(options.body);
    else req.end();
  });
}

test('public gateway routes Admin and MCP surfaces while preserving protocol headers', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-public-gateway-'));
  const tls = await ensureLocalTls(dir, { trust: false });
  const admin = await startOrigin(tls.serverOptions, 'admin');
  const mcp = await startOrigin(tls.serverOptions, 'mcp');
  const gateway = new PublicGateway({
    host: '127.0.0.1',
    port: 0,
    tls: tls.serverOptions,
    upstreamCa: tls.certificatePem,
    targets: { adminUrl: admin.url, mcpUrl: mcp.url },
  });
  await gateway.start();

  try {
    const adminResponse = await request(gateway, '/api/status?detail=1');
    assert.equal(adminResponse.status, 200);
    assert.equal(adminResponse.headers['x-origin'], 'admin');
    assert.match(String(adminResponse.headers['set-cookie'] ?? ''), /aevra_admin=test/);
    assert.deepEqual(JSON.parse(adminResponse.body), {
      origin: 'admin',
      path: '/api/status?detail=1',
      body: '',
      requestMcpSessionId: null,
    });

    const body = JSON.stringify({ action: 'once' });
    const bodyResponse = await request(gateway, '/api/echo', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(body)),
      },
      body,
    });
    assert.equal(JSON.parse(bodyResponse.body).body, body);
    assert.equal(admin.requests.filter((entry) => entry.path === '/api/echo').length, 1);

    for (const pathname of [
      '/mcp?transport=streamable',
      '/mcp/connector-token',
      '/oauth/token',
      '/.well-known/oauth-authorization-server',
    ]) {
      const response = await request(gateway, pathname, {
        headers: { 'mcp-session-id': 'request-session' },
      });
      assert.equal(response.headers['x-origin'], 'mcp');
      assert.equal(response.headers['mcp-session-id'], 'mcp-response-session');
      assert.equal(JSON.parse(response.body).requestMcpSessionId, 'request-session');
      assert.equal(JSON.parse(response.body).path, pathname);
    }

    const fallback = await request(gateway, '/not-a-special-route');
    assert.equal(fallback.headers['x-origin'], 'admin');

    const redirect = await request(gateway, '/redirect');
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.location, '/next');
  } finally {
    await gateway.close();
    await Promise.all([
      new Promise<void>((resolve) => admin.server.close(() => resolve())),
      new Promise<void>((resolve) => mcp.server.close(() => resolve())),
    ]);
    rmSync(dir, { recursive: true, force: true });
  }
});
