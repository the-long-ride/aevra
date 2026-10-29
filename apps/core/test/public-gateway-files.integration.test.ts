import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PublicGateway } from '../src/gateway/public-gateway.js';
import { ensureLocalTls } from '../src/tls/local-tls.js';

async function startOrigin(tls: https.ServerOptions, name: string) {
  const seen: string[] = [];
  const server = https.createServer(tls, (req, res) => {
    seen.push(req.url ?? '');
    res.setHeader('x-origin', name);
    res.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return { server, seen, url: `https://127.0.0.1:${address.port}` };
}

function get(gateway: PublicGateway, pathname: string) {
  return new Promise<{ status: number; origin: string | undefined }>((resolve, reject) => {
    https
      .get(new URL(pathname, gateway.url()), { rejectUnauthorized: false }, (res) => {
        res.resume();
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, origin: res.headers['x-origin'] as string }),
        );
      })
      .on('error', reject);
  });
}

test('gateway forwards /files/<secret> to the MCP target even with the admin proxy off', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-gateway-files-'));
  const tls = await ensureLocalTls(dir, { trust: false });
  const admin = await startOrigin(tls.serverOptions, 'admin');
  const mcp = await startOrigin(tls.serverOptions, 'mcp');
  const gateway = new PublicGateway({
    host: '127.0.0.1',
    port: 0,
    tls: tls.serverOptions,
    upstreamCa: tls.certificatePem,
    targets: { adminUrl: admin.url, mcpUrl: mcp.url },
    adminProxyEnabled: () => false,
  });
  await gateway.start();
  try {
    const response = await get(gateway, '/files/sample-link-secret');
    assert.equal(response.status, 200);
    assert.equal(response.origin, 'mcp');
    assert.deepEqual(mcp.seen, ['/files/sample-link-secret']);
    assert.deepEqual(admin.seen, []);
    const other = await get(gateway, '/api/status');
    assert.notEqual(other.origin, 'admin');
    assert.deepEqual(admin.seen, []);
  } finally {
    await gateway.close();
    await Promise.all([
      new Promise<void>((resolve) => admin.server.close(() => resolve())),
      new Promise<void>((resolve) => mcp.server.close(() => resolve())),
    ]);
    rmSync(dir, { recursive: true, force: true });
  }
});
