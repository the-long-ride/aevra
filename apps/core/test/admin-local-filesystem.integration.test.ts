import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import https from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { AdminCredentialVerifier } from '../src/admin/admin-credentials.js';
import { AdminBootstrapService } from '../src/admin/bootstrap.js';
import { LocalFilesystemService } from '../src/admin/local-filesystem.js';
import { AdminServer } from '../src/admin/server.js';
import { ensureLocalTls } from '../src/tls/local-tls.js';

function request(
  server: AdminServer,
  pathname: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
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

function cookie(response: { headers: IncomingHttpHeaders }) {
  const raw = response.headers['set-cookie'];
  return (Array.isArray(raw) ? raw[0] : (raw ?? '')).split(';')[0];
}

test('server filesystem routes require an authenticated Admin session', async () => {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), 'aevra-local-fs-route-'));
  const tls = await ensureLocalTls(stateDir, { trust: false });
  const db = AevraDatabase.open(':memory:');
  const bootstrap = new AdminBootstrapService(db.raw());
  const credentialVerifier = await AdminCredentialVerifier.create('admin', 'secret');
  const localFilesystem = new LocalFilesystemService({
    platform: 'linux',
    runner: async () => ({ code: 0, stdout: `${stateDir}\n`, stderr: '' }),
  });
  const server = new AdminServer('127.0.0.1', 0, () => ({ core: 'running' }), {
    bootstrap,
    credentialVerifier,
    tls: tls.serverOptions,
    advertisedHost: '127.0.0.1',
    api: { localFilesystem },
  });
  await server.start();

  try {
    const target = encodeURIComponent(stateDir);
    assert.equal((await request(server, `/api/local/directories?path=${target}`)).status, 401);
    assert.equal(
      (await request(server, '/api/local/folder-picker', { method: 'POST' })).status,
      401,
    );

    const login = await request(server, '/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: server.url(),
      },
      body: JSON.stringify({ username: 'admin', password: 'secret' }),
    });
    assert.equal(login.status, 200);
    const sessionCookie = cookie(login);

    const listing = await request(server, `/api/local/directories?path=${target}`, {
      headers: { cookie: sessionCookie },
    });
    assert.equal(listing.status, 200);
    const value = JSON.parse(listing.body);
    assert.equal(value.path, await localFilesystem.canonicalDirectory(stateDir));

    const picker = await request(server, '/api/local/folder-picker', {
      method: 'POST',
      headers: { cookie: sessionCookie, origin: server.url() },
    });
    assert.equal(picker.status, 200);
    assert.deepEqual(JSON.parse(picker.body), {
      status: 'selected',
      path: await localFilesystem.canonicalDirectory(stateDir),
    });
  } finally {
    await server.close();
    db.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('workspace registration canonicalizes the server root before persistence', async () => {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), 'aevra-workspace-root-'));
  mkdirSync(path.join(stateDir, 'child'));
  const tls = await ensureLocalTls(stateDir, { trust: false });
  const db = AevraDatabase.open(':memory:');
  const bootstrap = new AdminBootstrapService(db.raw());
  const credentialVerifier = await AdminCredentialVerifier.create('admin', 'secret');
  const localFilesystem = new LocalFilesystemService();
  let created: { name: string; hostRoot: string; description?: string } | undefined;
  const workspaces = {
    create(input: { name: string; hostRoot: string; description?: string }) {
      created = input;
      return { id: 'ws-canonical', ...input };
    },
  };
  const server = new AdminServer('127.0.0.1', 0, () => ({ core: 'running' }), {
    bootstrap,
    credentialVerifier,
    tls: tls.serverOptions,
    advertisedHost: '127.0.0.1',
    api: { localFilesystem, workspaces },
  });
  await server.start();

  try {
    const login = await request(server, '/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: server.url(),
      },
      body: JSON.stringify({ username: 'admin', password: 'secret' }),
    });
    assert.equal(login.status, 200);
    const sessionCookie = cookie(login);
    const submitted = path.join(stateDir, 'child', '..');
    const response = await request(server, '/api/workspaces', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
        origin: server.url(),
      },
      body: JSON.stringify({ name: 'Canonical', hostRoot: submitted }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(created, {
      name: 'Canonical',
      description: '',
      hostRoot: await localFilesystem.canonicalDirectory(stateDir),
    });
  } finally {
    await server.close();
    db.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
});
