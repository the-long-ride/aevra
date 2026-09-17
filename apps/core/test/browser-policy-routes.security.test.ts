import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { AdminCredentialVerifier } from '../src/admin/admin-credentials.js';
import { AdminBootstrapService } from '../src/admin/bootstrap.js';
import { AdminServer } from '../src/admin/server.js';
import { ensureLocalTls } from '../src/tls/local-tls.js';

function request(
  server: AdminServer,
  pathname: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; body: string }> {
  const target = new URL(pathname, server.url());
  return new Promise((resolve, reject) => {
    const req = https.request(
      target,
      { method: options.method ?? 'GET', headers: options.headers, rejectUnauthorized: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function admin() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-browser-policy-'));
  const tls = await ensureLocalTls(dir, { trust: false });
  const db = AevraDatabase.open(':memory:');
  const server = new AdminServer('127.0.0.1', 0, () => ({ core: 'running' }), {
    bootstrap: new AdminBootstrapService(db.raw()),
    credentialVerifier: await AdminCredentialVerifier.create('operator', 'a whole phrase of words'),
    controlSecret: 'local-control',
    tls: tls.serverOptions,
    advertisedHost: '127.0.0.1',
  });
  await server.start();
  return {
    server,
    close: async () => {
      await server.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// The pairing route is reachable unauthenticated because the extension has no
// admin session yet. That exemption is scoped to one path, and the policy route
// decides what the agent may drive - it must not inherit it.
test('reading the origin policy needs an admin session', async () => {
  const fixture = await admin();
  try {
    const response = await request(fixture.server, '/api/browser/policy');
    assert.equal(response.status, 401);
  } finally {
    await fixture.close();
  }
});

test('writing the origin policy needs an admin session', async () => {
  const fixture = await admin();
  try {
    const response = await request(fixture.server, '/api/browser/policy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ loopbackClass: 'NORMAL' }),
    });
    assert.equal(response.status, 401);
    assert.equal(response.body.includes('NORMAL'), false);
  } finally {
    await fixture.close();
  }
});
