import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import https from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { SettingsRepository } from '../../../packages/store/src/settings.js';
import { loadCoreConfig } from '../src/config.js';
import type { ExposureConfig } from '../src/exposure/types.js';
import { createCoreRuntime } from '../src/runtime.js';
import { ensureLocalTls } from '../src/tls/local-tls.js';

function worker() {
  return {
    async start() {
      return {
        async execute() {
          return { ok: false, error: { code: 'EXECUTOR_UNAVAILABLE', message: 'x' } } as any;
        },
        async health() {
          return { ready: true, pid: 1 };
        },
        async close() {},
      };
    },
    async close() {},
  };
}

function getJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { rejectUnauthorized: false }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (error) {
            reject(error);
          }
        });
      })
      .once('error', reject);
  });
}

function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: 'POST',
        rejectUnauthorized: false,
        headers: { 'content-type': 'application/json', ...headers },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    request.once('error', reject);
    request.end(JSON.stringify(body));
  });
}

const cases: Array<{ name: string; config: ExposureConfig; publicUrl: string }> = [
  {
    name: 'direct',
    config: {
      provider: 'direct',
      publicUrl: 'https://direct.example.com',
      direct: { host: '127.0.0.1' },
    },
    publicUrl: 'https://direct.example.com',
  },
  {
    name: 'cloudflare',
    config: {
      provider: 'cloudflare',
      publicUrl: 'https://cloudflare.example.com',
      cloudflare: {
        ownership: 'external',
        authMode: 'oauth',
        hostname: 'cloudflare.example.com',
      },
    },
    publicUrl: 'https://cloudflare.example.com',
  },
  {
    name: 'ngrok',
    config: {
      provider: 'ngrok',
      publicUrl: 'https://aevra.ngrok.app',
      ngrok: { ownership: 'external' },
    },
    publicUrl: 'https://aevra.ngrok.app',
  },
  {
    name: 'external',
    config: {
      provider: 'external',
      publicUrl: 'https://proxy.example.com',
    },
    publicUrl: 'https://proxy.example.com',
  },
];

for (const item of cases) {
  test(`runtime OAuth metadata uses ${item.name} MCP URL while Admin login uses its separate Admin URL`, async () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), `aevra-exposure-${item.name}-`));
    const config = {
      ...loadCoreConfig({
        AEVRA_STATE_DIR: stateDir,
        AEVRA_USERNAME: 'admin',
        AEVRA_PASSWORD: 'secret',
      }),
      publicPort: 0,
      adminPort: 0,
      mcpPort: 0,
    };
    const database = AevraDatabase.open(config.databasePath);
    const adminPublicUrl = `https://admin-${item.name}.example.com`;
    new SettingsRepository(database.raw()).set('exposure.config', {
      ...item.config,
      adminPublicUrl,
    });
    database.close();

    const runtime = await createCoreRuntime(config, {
      worker: worker(),
      ensureTls: async (current) => {
        const tls = await ensureLocalTls(current.stateDir, { trust: false });
        return item.name === 'direct' ? { ...tls, managed: false } : tls;
      },
    });

    try {
      await runtime.start();
      const gatewayUrl = runtime.gatewayUrl;
      assert.match(gatewayUrl, /^https:\/\//);
      assert.equal(runtime.publicUrl, item.publicUrl);
      const metadata = await getJson(`${gatewayUrl}/.well-known/oauth-protected-resource/mcp`);
      assert.equal(metadata.resource, `${item.publicUrl}/mcp`);
      assert.deepEqual(metadata.authorization_servers, [item.publicUrl]);

      const login = await postJson(
        `${gatewayUrl}/api/auth/login`,
        { username: 'admin', password: 'secret' },
        { origin: adminPublicUrl, 'sec-fetch-site': 'same-origin' },
      );
      assert.equal(login.status, 200);
      assert.match(String(login.headers['set-cookie'] ?? ''), /aevra_admin=/);

      const rejectedMcpOrigin = await postJson(
        `${gatewayUrl}/api/auth/login`,
        { username: 'admin', password: 'secret' },
        { origin: item.publicUrl, 'sec-fetch-site': 'same-origin' },
      );
      assert.equal(rejectedMcpOrigin.status, 403);
    } finally {
      await runtime.close();
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
}

test('direct exposure rejects the managed localhost certificate before opening the public listener', async () => {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), 'aevra-direct-managed-tls-'));
  const config = {
    ...loadCoreConfig({
      AEVRA_STATE_DIR: stateDir,
      AEVRA_USERNAME: 'admin',
      AEVRA_PASSWORD: 'secret',
    }),
    publicPort: 0,
    adminPort: 0,
    mcpPort: 0,
  };
  const database = AevraDatabase.open(config.databasePath);
  new SettingsRepository(database.raw()).set('exposure.config', {
    provider: 'direct',
    publicUrl: 'https://direct.example.com',
    direct: { host: '127.0.0.1' },
  } satisfies ExposureConfig);
  database.close();

  const runtime = await createCoreRuntime(config, {
    worker: worker(),
    ensureTls: (current) => ensureLocalTls(current.stateDir, { trust: false }),
  });
  try {
    await assert.rejects(runtime.start(), /Direct exposure requires trusted TLS/i);
  } finally {
    await runtime.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('runtime health exposes live tunnel reachability for configured remote exposure', async () => {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), 'aevra-live-tunnel-health-'));
  const config = {
    ...loadCoreConfig({
      AEVRA_STATE_DIR: stateDir,
      AEVRA_USERNAME: 'admin',
      AEVRA_PASSWORD: 'secret',
    }),
    publicPort: 0,
    adminPort: 0,
    mcpPort: 0,
  };
  const database = AevraDatabase.open(config.databasePath);
  new SettingsRepository(database.raw()).set('exposure.config', {
    provider: 'cloudflare',
    publicUrl: 'https://cloudflare.example.com',
    cloudflare: {
      ownership: 'external',
      authMode: 'oauth',
      hostname: 'cloudflare.example.com',
    },
  } satisfies ExposureConfig);
  database.close();

  let checks = 0;
  const cloudflare: any = {
    start: async () => ({ publicUrl: 'https://cloudflare.example.com' }),
    stop: async () => {},
    status: async () => ({ state: 'ready' }),
    ownership: () => 'external',
    detectCloudflared: async () => ({ found: true }),
    authenticationStatus: async () => ({ authenticated: true, message: 'ok' }),
    authenticate: async () => ({ code: 0, stdout: '', stderr: '' }),
    setup: async () => {
      throw new Error('unused');
    },
    startManagedTunnel: async () => {},
    stopManagedTunnel: async () => {},
    checkReachability: async () => {
      checks++;
      return { reachable: true, message: 'reachable' };
    },
  };
  const runtime = await createCoreRuntime(config, {
    worker: worker(),
    cloudflare,
    ensureTls: (current) => ensureLocalTls(current.stateDir, { trust: false }),
  });

  try {
    await runtime.start();
    let health: any;
    for (let attempt = 0; attempt < 10; attempt++) {
      health = await getJson(`${runtime.adminUrl}/api/health`);
      if (health.tunnelReachable === true) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(health.tunnel, 'configured');
    assert.equal(health.tunnelReachable, true);
    assert.equal(checks >= 1, true);
  } finally {
    await runtime.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('managed provider failure keeps the local gateway available without a public URL fallback', async () => {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), 'aevra-managed-provider-fail-'));
  const config = {
    ...loadCoreConfig({
      AEVRA_STATE_DIR: stateDir,
      AEVRA_USERNAME: 'admin',
      AEVRA_PASSWORD: 'secret',
    }),
    publicPort: 0,
    adminPort: 0,
    mcpPort: 0,
  };
  const database = AevraDatabase.open(config.databasePath);
  new SettingsRepository(database.raw()).set('exposure.config', {
    provider: 'cloudflare',
    publicUrl: 'https://cloudflare.example.com',
    cloudflare: {
      ownership: 'managed',
      authMode: 'oauth',
      tunnelId: 'tid',
      hostname: 'cloudflare.example.com',
    },
  } satisfies ExposureConfig);
  database.close();

  let starts = 0;
  const cloudflare: any = {
    start: async () => {
      starts++;
      throw new Error('provider-start-failed');
    },
    stop: async () => {},
    status: async () => ({ state: 'error' }),
    ownership: () => 'managed',
    detectCloudflared: async () => ({ found: true }),
    authenticationStatus: async () => ({ authenticated: true, message: 'ok' }),
    authenticate: async () => ({ code: 0, stdout: '', stderr: '' }),
    setup: async () => {
      throw new Error('unused');
    },
    startManagedTunnel: async () => {},
    stopManagedTunnel: async () => {},
    checkReachability: async () => ({ reachable: false, message: 'offline' }),
  };
  const runtime = await createCoreRuntime(config, {
    worker: worker(),
    cloudflare,
    ensureTls: (current) => ensureLocalTls(current.stateDir, { trust: false }),
  });

  try {
    await runtime.start();
    assert.equal(starts, 1);
    assert.ok(runtime.gatewayUrl.startsWith('https://'));
    assert.equal(runtime.publicUrl, undefined);
  } finally {
    await runtime.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
});
