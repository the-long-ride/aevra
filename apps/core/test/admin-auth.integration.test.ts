import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import https from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { AdminCredentialVerifier } from '../src/admin/admin-credentials.js';
import { AdminBootstrapService } from '../src/admin/bootstrap.js';
import { AdminServer } from '../src/admin/server.js';
import { IpRateLimiter } from '../src/mcp/rate-limit.js';
import { ensureLocalTls } from '../src/tls/local-tls.js';

interface ResponseResult {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function request(
  server: AdminServer,
  pathname: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<ResponseResult> {
  const target = new URL(pathname, server.url());
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
    if (options.body) req.write(options.body);
    req.end();
  });
}

function firstCookie(response: ResponseResult) {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  return (value ?? '').split(';')[0];
}

async function createHttpsAdmin(loginLimiter?: IpRateLimiter, trustedOrigins?: () => string[]) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-admin-auth-'));
  const tls = await ensureLocalTls(dir, { trust: false });
  const db = AevraDatabase.open(':memory:');
  const bootstrap = new AdminBootstrapService(db.raw());
  const credentialVerifier = await AdminCredentialVerifier.create('admin', 'secret');
  const server = new AdminServer('127.0.0.1', 0, () => ({ core: 'running' }), {
    bootstrap,
    credentialVerifier,
    loginLimiter,
    controlSecret: 'local-control',
    tls: tls.serverOptions,
    advertisedHost: '127.0.0.1',
    trustedOrigins,
  });
  await server.start();
  return {
    server,
    bootstrap,
    close: async () => {
      await server.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('admin login accepts configured Admin and additional trusted origins', async () => {
  const fixture = await createHttpsAdmin(undefined, () => [
    'https://admin.example.com',
    'https://ops.example.com',
  ]);
  try {
    const response = await request(fixture.server, '/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://admin.example.com',
        'sec-fetch-site': 'same-origin',
      },
      body: JSON.stringify({ username: 'admin', password: 'secret' }),
    });

    assert.equal(response.status, 200);
    assert.match(firstCookie(response), /^aevra_admin=/);
  } finally {
    await fixture.close();
  }
});

test('admin login rejects unknown origins even when forwarded headers name the public host', async () => {
  const fixture = await createHttpsAdmin(undefined, () => [
    'https://admin.example.com',
    'https://ops.example.com',
  ]);
  try {
    const response = await request(fixture.server, '/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example',
        'sec-fetch-site': 'same-origin',
        'x-forwarded-host': 'admin.example.com',
        'x-forwarded-proto': 'https',
      },
      body: JSON.stringify({ username: 'admin', password: 'secret' }),
    });

    assert.equal(response.status, 403);
    assert.deepEqual(JSON.parse(response.body), {
      error: {
        code: 'CSRF_REJECTED',
        message: 'State-changing admin requests must be same-origin',
      },
    });
  } finally {
    await fixture.close();
  }
});

test('MCP public origin is not implicitly trusted for Admin login', async () => {
  const fixture = await createHttpsAdmin(undefined, () => ['https://admin.example.com']);
  try {
    const response = await request(fixture.server, '/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://mcp.example.com',
        'sec-fetch-site': 'same-origin',
      },
      body: JSON.stringify({ username: 'admin', password: 'secret' }),
    });
    assert.equal(response.status, 403);
  } finally {
    await fixture.close();
  }
});
test('admin sessions can be issued and revoked independently of bootstrap tokens', async () => {
  const db = AevraDatabase.open(':memory:');
  const service = new AdminBootstrapService(db.raw());
  const first = await service.issueSession();
  const second = await service.issueSession();
  assert.equal(service.validateSession(first.sessionId), true);
  assert.equal(service.validateSession(second.sessionId), true);
  service.revokeSession(first.sessionId);
  assert.equal(service.validateSession(first.sessionId), false);
  assert.equal(service.validateSession(second.sessionId), true);
  db.close();
});

test('password login is the only browser session issuance path', async () => {
  const fixture = await createHttpsAdmin();
  try {
    assert.equal((await request(fixture.server, '/api/status')).status, 401);

    const sessionBefore = await request(fixture.server, '/api/auth/session');
    assert.equal(sessionBefore.status, 200);
    assert.deepEqual(JSON.parse(sessionBefore.body), { authenticated: false });

    const invalid = await request(fixture.server, '/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: fixture.server.url(),
      },
      body: JSON.stringify({ username: 'admin', password: 'wrong' }),
    });
    assert.equal(invalid.status, 401);
    assert.deepEqual(JSON.parse(invalid.body), { error: 'Invalid credentials' });

    const firstLogin = await request(fixture.server, '/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: fixture.server.url(),
      },
      body: JSON.stringify({ username: 'admin', password: 'secret' }),
    });
    assert.equal(firstLogin.status, 200);
    const firstSetCookie = (firstLogin.headers['set-cookie'] ?? []).join('; ');
    assert.match(firstSetCookie, /Secure/i);
    assert.match(firstSetCookie, /HttpOnly/i);
    assert.match(firstSetCookie, /SameSite=Strict/i);
    assert.match(firstSetCookie, /Path=\//i);
    const first = firstCookie(firstLogin);
    assert.match(first, /^aevra_admin=/);

    const secondLogin = await request(fixture.server, '/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: fixture.server.url(),
      },
      body: JSON.stringify({ username: 'admin', password: 'secret' }),
    });
    const second = firstCookie(secondLogin);
    assert.notEqual(first, second);

    assert.equal(
      (
        await request(fixture.server, '/api/status', {
          headers: { cookie: first },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(fixture.server, '/api/status', {
          headers: { cookie: second },
        })
      ).status,
      200,
    );

    const logout = await request(fixture.server, '/api/auth/logout', {
      method: 'POST',
      headers: { cookie: first, origin: fixture.server.url() },
    });
    assert.equal(logout.status, 200);
    assert.match((logout.headers['set-cookie'] ?? []).join('; '), /Max-Age=0/i);
    assert.equal(
      (await request(fixture.server, '/api/status', { headers: { cookie: first } })).status,
      401,
    );
    assert.equal(
      (await request(fixture.server, '/api/status', { headers: { cookie: second } })).status,
      200,
    );

    const bootstrap = await request(fixture.server, '/api/local/bootstrap', {
      method: 'POST',
      headers: { 'x-aevra-control': 'local-control' },
    });
    if (bootstrap.status === 200) {
      const token = (JSON.parse(bootstrap.body) as { token?: string }).token;
      assert.equal(typeof token, 'string');
      const bypass = await request(
        fixture.server,
        `/auth/bootstrap?token=${encodeURIComponent(token ?? '')}`,
      );
      assert.notEqual(bypass.status, 302);
      assert.equal(bypass.headers['set-cookie'], undefined);
    }
  } finally {
    await fixture.close();
  }
});

test('admin login returns 429 when the dedicated IP limiter is exhausted', async () => {
  const fixture = await createHttpsAdmin(new IpRateLimiter(1, 0));
  const attempt = () =>
    request(fixture.server, '/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: fixture.server.url(),
      },
      body: JSON.stringify({ username: 'admin', password: 'wrong' }),
    });
  try {
    assert.equal((await attempt()).status, 401);
    assert.equal((await attempt()).status, 429);
  } finally {
    await fixture.close();
  }
});

test('admin login rejects credential submission over plain HTTP', async () => {
  const db = AevraDatabase.open(':memory:');
  const bootstrap = new AdminBootstrapService(db.raw());
  const credentialVerifier = await AdminCredentialVerifier.create('admin', 'secret');
  const server = new AdminServer('127.0.0.1', 0, () => ({ core: 'running' }), {
    bootstrap,
    credentialVerifier,
  });
  await server.start();
  try {
    const response = await fetch(`${server.url()}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: server.url() },
      body: JSON.stringify({ username: 'admin', password: 'secret' }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: { code: 'HTTPS_REQUIRED', message: 'Admin login requires HTTPS' },
    });
  } finally {
    await server.close();
    db.close();
  }
});
