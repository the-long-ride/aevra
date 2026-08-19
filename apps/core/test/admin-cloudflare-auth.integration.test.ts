import assert from 'node:assert/strict';
import test from 'node:test';
import { AdminServer } from '../src/admin/server.js';

async function request(url: string, init: RequestInit = {}) {
  return fetch(url, { ...init, headers: { cookie: 'aevra_admin=test', ...(init.headers ?? {}) } });
}

test('Cloudflare status reports an already authenticated cloudflared session', async () => {
  const bootstrap = { validateSession: (v: string | undefined) => v === 'test' } as any;
  const settings = { get: (_key: string, fallback: any) => fallback };
  let logins = 0;
  const cloudflare = {
    detectCloudflared: async () => ({ found: true, version: 'cloudflared 2026.5.2' }),
    authenticationStatus: async () => ({
      authenticated: true,
      message: 'Existing Cloudflare login is valid',
    }),
    authenticate: async () => {
      logins++;
      return { code: 0, stdout: 'unused', stderr: '' };
    },
    ownership: () => 'managed',
  };
  const server = new AdminServer('127.0.0.1', 0, () => ({ core: 'running' }), {
    bootstrap,
    api: { settings, cloudflare } as any,
  });
  await server.start();
  const status = await request(`${server.url()}/api/cloudflare/status`);
  const value = (await status.json()) as any;
  assert.equal(value.authenticated, true);
  assert.match(value.authenticationMessage, /existing cloudflare login/i);
  const auth = await request(`${server.url()}/api/cloudflare/authenticate`, {
    method: 'POST',
    headers: { origin: server.url(), 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(auth.status, 200);
  assert.equal(logins, 1); // manager-level detection prevents the real CLI login; this fake verifies the endpoint remains callable.
  await server.close();
});
