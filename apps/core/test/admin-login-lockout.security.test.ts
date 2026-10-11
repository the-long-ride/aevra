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
import type { LoginLockoutEvent } from '../src/admin/login-throttle.js';
import { AdminServer } from '../src/admin/server.js';
import { GATEWAY_TRUST_HEADER } from '../src/gateway/public-gateway.js';
import { ensureLocalTls } from '../src/tls/local-tls.js';

const gatewayPhrase = 'gateway phrase';
const correctPhrase = 'correct phrase';
const wrongPhrase = 'wrong phrase';

interface ResponseResult {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function post(
  server: AdminServer,
  headers: Record<string, string>,
  body: object,
): Promise<ResponseResult> {
  const target = new URL('/api/auth/login', server.url());
  return new Promise((resolve, reject) => {
    const req = https.request(
      target,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: server.url(), ...headers },
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
    req.end(JSON.stringify(body));
  });
}

async function createAdmin(options: {
  trustForwardedClientIp?: () => boolean;
  onLoginLockout?: (event: LoginLockoutEvent) => void;
}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-login-lockout-'));
  const tls = await ensureLocalTls(dir, { trust: false });
  const db = AevraDatabase.open(':memory:');
  const server = new AdminServer('127.0.0.1', 0, () => ({ core: 'running' }), {
    bootstrap: new AdminBootstrapService(db.raw()),
    credentialVerifier: await AdminCredentialVerifier.create('admin', correctPhrase),
    tls: tls.serverOptions,
    advertisedHost: '127.0.0.1',
    gatewayTrustSecret: gatewayPhrase,
    ...options,
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

const guess = (server: AdminServer, headers: Record<string, string>, username = 'admin') =>
  post(server, headers, { username, password: wrongPhrase });

async function spoofedGuesses(
  server: AdminServer,
  headers: (index: number) => Record<string, string>,
) {
  const statuses: number[] = [];
  for (let index = 0; index < 6; index++) {
    statuses.push((await guess(server, headers(index))).status);
  }
  return statuses;
}

test('a spoofed CF-Connecting-IP cannot dodge the lockout by default', async () => {
  const admin = await createAdmin({});
  try {
    const statuses = await spoofedGuesses(admin.server, (index) => ({
      'cf-connecting-ip': `203.0.113.${index + 1}`,
    }));
    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
  } finally {
    await admin.close();
  }
});

test('a declared proxy is not believed without the gateway trust header', async () => {
  const admin = await createAdmin({ trustForwardedClientIp: () => true });
  try {
    const statuses = await spoofedGuesses(admin.server, (index) => ({
      'cf-connecting-ip': `203.0.113.${index + 1}`,
    }));
    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
  } finally {
    await admin.close();
  }
});

test('a forwarded address that is not an IP falls back to the peer address', async () => {
  const admin = await createAdmin({ trustForwardedClientIp: () => true });
  try {
    const statuses = await spoofedGuesses(admin.server, () => ({
      [GATEWAY_TRUST_HEADER]: gatewayPhrase,
      'cf-connecting-ip': 'not an address',
    }));
    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
  } finally {
    await admin.close();
  }
});

test('the trusted gateway gives each real client its own lockout', async () => {
  const admin = await createAdmin({ trustForwardedClientIp: () => true });
  const via = (ip: string) => ({ [GATEWAY_TRUST_HEADER]: gatewayPhrase, 'cf-connecting-ip': ip });
  try {
    for (let index = 0; index < 5; index++) {
      assert.equal((await guess(admin.server, via('203.0.113.50'))).status, 401);
    }
    assert.equal((await guess(admin.server, via('203.0.113.50'))).status, 429);
    assert.equal((await guess(admin.server, via('203.0.113.51'))).status, 401);
  } finally {
    await admin.close();
  }
});

test('a locked response carries Retry-After and reveals nothing about the username', async () => {
  const lockouts: LoginLockoutEvent[] = [];
  const admin = await createAdmin({ onLoginLockout: (event) => lockouts.push(event) });
  try {
    const known = await guess(admin.server, {}, 'admin');
    const unknown = await guess(admin.server, {}, 'ghost');
    assert.deepEqual([known.status, known.body], [unknown.status, unknown.body]);

    for (let index = 0; index < 3; index++) await guess(admin.server, {}, 'admin');
    assert.deepEqual(lockouts, []);
    await guess(admin.server, {}, 'admin');
    assert.deepEqual(
      lockouts.map((event) => [event.scope, event.lockSeconds, event.level]),
      [['ip-username', 60, 1]],
    );

    const lockedKnown = await post(
      admin.server,
      {},
      { username: 'admin', password: correctPhrase },
    );
    assert.equal(lockedKnown.status, 429);
    assert.equal(lockedKnown.headers['retry-after'], '60');
    assert.equal(lockedKnown.headers['set-cookie'], undefined);
    assert.equal(lockedKnown.body, JSON.stringify({ error: 'Too many login attempts' }));

    for (let index = 0; index < 4; index++) await guess(admin.server, {}, 'ghost');
    const lockedUnknown = await guess(admin.server, {}, 'ghost');
    assert.deepEqual([lockedUnknown.status, lockedUnknown.body], [429, lockedKnown.body]);
    assert.equal(lockedUnknown.headers['retry-after'], '60');
  } finally {
    await admin.close();
  }
});

test('a lockout on one username leaves the correct password working for another pair', async () => {
  const admin = await createAdmin({});
  try {
    for (let index = 0; index < 5; index++) await guess(admin.server, {}, 'ghost');
    assert.equal((await guess(admin.server, {}, 'ghost')).status, 429);
    const login = await post(admin.server, {}, { username: 'admin', password: correctPhrase });
    assert.equal(login.status, 200);
  } finally {
    await admin.close();
  }
});
