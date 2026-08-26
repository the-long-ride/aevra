import assert from 'node:assert/strict';
import test from 'node:test';
import { RuntimeExposureWiring } from '../src/exposure/runtime-wiring.js';

test('manual exposure test uses live watchdog health instead of configured provider state', async () => {
  const wiring = Object.create(RuntimeExposureWiring.prototype) as any;
  wiring.controller = {
    status: () => ({
      provider: 'cloudflare',
      state: 'ready',
      publicUrl: 'https://aevra.example.com',
    }),
    test: async () => ({ reachable: true }),
  };
  wiring.watchdog = {
    checkNow: async () => ({
      reachable: false,
      checkedAt: '2026-08-26T00:00:00.000Z',
      message: 'Tunnel down',
    }),
  };

  assert.deepEqual(await wiring.test(), {
    provider: 'cloudflare',
    reachable: false,
    state: 'error',
    publicUrl: 'https://aevra.example.com',
    message: 'Tunnel down',
  });
});

test('failed exposure reconfiguration still refreshes watchdog ownership', async () => {
  const wiring = Object.create(RuntimeExposureWiring.prototype) as any;
  wiring.controller = {
    configure: async () => {
      throw new Error('provider failed');
    },
  };
  let refreshed = 0;
  wiring.refreshWatchdog = () => {
    refreshed++;
  };

  await assert.rejects(() => wiring.configure({ provider: 'cloudflare' }), /provider failed/);
  assert.equal(refreshed, 1);
});

test('runtime Admin URL prefers saved config while environment trusted origins remain additive', () => {
  const wiring = Object.create(RuntimeExposureWiring.prototype) as any;
  wiring.config = {
    adminPublicUrl: 'https://bootstrap.example.com',
    trustedAdminOrigins: ['https://ops.example.com'],
  };
  wiring.controller = {
    currentConfig: () => ({
      provider: 'cloudflare',
      adminPublicUrl: 'https://saved.example.com',
      trustedAdminOrigins: ['https://extra.example.com'],
    }),
    status: () => ({
      provider: 'cloudflare',
      state: 'ready',
      publicUrl: 'https://mcp.example.com',
      config: {
        provider: 'cloudflare',
        adminPublicUrl: 'https://saved.example.com',
        trustedAdminOrigins: ['https://extra.example.com'],
      },
    }),
  };
  wiring.watchdog = undefined;

  assert.equal(wiring.adminPublicUrl(), 'https://saved.example.com');
  assert.deepEqual(wiring.trustedAdminOrigins(), [
    'https://saved.example.com',
    'https://extra.example.com',
    'https://ops.example.com',
  ]);
  assert.equal(wiring.status().adminPublicUrl, 'https://saved.example.com');
  assert.deepEqual(wiring.status().trustedAdminOrigins, [
    'https://saved.example.com',
    'https://extra.example.com',
    'https://ops.example.com',
  ]);
});

test('Admin public URL probe tests an unsaved candidate within its path prefix', async () => {
  const wiring = Object.create(RuntimeExposureWiring.prototype) as any;
  wiring.config = { trustedAdminOrigins: [] };
  wiring.adminPublicUrl = () => 'https://saved.example.com';
  wiring.trustedAdminOrigins = () => ['https://saved.example.com', 'https://ops.example.com'];
  const originalFetch = globalThis.fetch;
  const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input: String(input), init });
    return new Response(JSON.stringify({ core: 'running', version: '0.1.1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    assert.deepEqual(
      await wiring.testAdmin({
        publicUrl: 'https://candidate.example.com/control/',
        trustedOrigins: ['https://ops.example.com/path'],
      }),
      {
        configured: true,
        trusted: true,
        reachable: true,
        publicUrl: 'https://candidate.example.com/control',
      },
    );
    assert.equal(calls[0]?.input, 'https://candidate.example.com/control/api/health');
    assert.equal(calls[0]?.init?.method, 'GET');
    assert.equal(calls[0]?.init?.redirect, 'error');
    const headers = new Headers(calls[0]?.init?.headers);
    assert.equal(headers.has('authorization'), false);
    assert.equal(headers.has('cookie'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Admin public URL probe reports unconfigured without issuing a request', async () => {
  const wiring = Object.create(RuntimeExposureWiring.prototype) as any;
  wiring.adminPublicUrl = () => undefined;
  wiring.trustedAdminOrigins = () => [];
  assert.deepEqual(await wiring.testAdmin(), {
    configured: false,
    trusted: false,
    reachable: false,
    message: 'Admin public URL is not configured',
  });
});
