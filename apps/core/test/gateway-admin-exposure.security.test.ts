import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import https, { type Server } from 'node:https';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PublicGateway } from '../src/gateway/public-gateway.js';
import { ensureLocalTls } from '../src/tls/local-tls.js';

async function startOrigin(
  tls: https.ServerOptions,
  name: 'admin' | 'mcp',
): Promise<{ server: Server; url: string; hits: string[] }> {
  const hits: string[] = [];
  const server = https.createServer(tls, (req, res) => {
    hits.push(req.url ?? '/');
    res.statusCode = 200;
    res.setHeader('x-origin', name);
    res.end(JSON.stringify({ origin: name }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { server, url: `https://127.0.0.1:${address.port}`, hits };
}

function get(gateway: PublicGateway, pathname: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      new URL(pathname, gateway.url()),
      { rejectUnauthorized: false },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function withGateway(
  adminProxyEnabled: boolean,
  run: (context: {
    gateway: PublicGateway;
    adminHits: string[];
    mcpHits: string[];
  }) => Promise<void>,
) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-gateway-admin-'));
  const tls = await ensureLocalTls(dir, { trust: false });
  const admin = await startOrigin(tls.serverOptions, 'admin');
  const mcp = await startOrigin(tls.serverOptions, 'mcp');
  const gateway = new PublicGateway({
    host: '127.0.0.1',
    port: 0,
    tls: tls.serverOptions,
    upstreamCa: tls.certificatePem,
    targets: { adminUrl: admin.url, mcpUrl: mcp.url },
    adminProxyEnabled: () => adminProxyEnabled,
  });
  await gateway.start();
  try {
    await run({ gateway, adminHits: admin.hits, mcpHits: mcp.hits });
  } finally {
    await gateway.close();
    await Promise.all([
      new Promise<void>((resolve) => admin.server.close(() => resolve())),
      new Promise<void>((resolve) => mcp.server.close(() => resolve())),
    ]);
    rmSync(dir, { recursive: true, force: true });
  }
}

test('admin paths are refused and never reach the upstream when exposure is disabled', async () => {
  await withGateway(false, async ({ gateway, adminHits }) => {
    for (const pathname of ['/api/status', '/api/auth/login', '/', '/aevra-logo.png']) {
      const response = await get(gateway, pathname);
      assert.equal(response.status, 404, `${pathname} must be refused`);
    }
    assert.deepEqual(adminHits, [], 'no admin request may be forwarded upstream');
  });
});

test('MCP paths still proxy when admin exposure is disabled', async () => {
  await withGateway(false, async ({ gateway, mcpHits }) => {
    assert.equal((await get(gateway, '/health')).status, 200);
    assert.equal((await get(gateway, '/mcp')).status, 200);
    assert.equal((await get(gateway, '/oauth/token')).status, 200);
    assert.deepEqual(mcpHits, ['/health', '/mcp', '/oauth/token']);
  });
});

test('admin paths proxy normally when admin exposure is enabled', async () => {
  await withGateway(true, async ({ gateway, adminHits }) => {
    assert.equal((await get(gateway, '/api/status')).status, 200);
    assert.deepEqual(adminHits, ['/api/status']);
  });
});
