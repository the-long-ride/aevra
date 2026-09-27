import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { OAuthRepository } from '../../../packages/store/src/oauth.js';
import { SettingsRepository } from '../../../packages/store/src/settings.js';
import { CloudflareAccessVerifier, RejectingIdentityVerifier } from '../src/auth/cloudflare.js';
import { RuntimeExposureWiring } from '../src/exposure/runtime-wiring.js';

const tls = {
  managed: false,
  serverOptions: {},
  certificatePem: '',
  certificatePath: '',
  caPath: '',
};

function fakeCloudflare(reachability: any = { reachable: true, message: 'ok' }): any {
  return {
    checkReachability: async () => reachability,
    start: async () => ({}),
    stop: async () => {},
  };
}

function build(
  exposure?: unknown,
  overrides: { managedTls?: boolean; config?: any; cloudflare?: any } = {},
) {
  const db = AevraDatabase.open(':memory:');
  const settings = new SettingsRepository(db.raw());
  if (exposure) settings.set('exposure.config', exposure);
  const config = {
    publicPort: 0,
    adminPort: 4101,
    mcpPort: 4102,
    publicHost: '127.0.0.1',
    ...overrides.config,
  };
  const wiring = new RuntimeExposureWiring(
    config,
    settings,
    new OAuthRepository(db.raw()),
    { ...tls, managed: overrides.managedTls ?? false } as any,
    overrides.cloudflare ?? fakeCloudflare(),
  );
  return { db, settings, wiring };
}

async function withFetch(
  responder: (url: string) => Response | Promise<Response>,
  run: (urls: string[]) => Promise<void>,
) {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    urls.push(String(url));
    return responder(String(url));
  }) as typeof fetch;
  try {
    await run(urls);
  } finally {
    globalThis.fetch = original;
  }
}

async function withEnv(
  values: Record<string, string | undefined>,
  run: () => void | Promise<void>,
) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const noCfEnv = { AEVRA_CF_ISSUER: undefined, AEVRA_CF_AUDIENCE: undefined };

test('direct exposure is refused when only the managed localhost certificate exists', () => {
  const exposure = {
    provider: 'direct',
    publicUrl: 'https://mcp.example.com',
    direct: { host: '0.0.0.0' },
  };
  assert.throws(
    () => build(exposure, { managedTls: true }),
    /Direct exposure requires trusted TLS/,
  );
});

test('remote identity verifier follows Cloudflare Access config and environment overrides', async () => {
  await withEnv(noCfEnv, () => {
    const access = build({
      provider: 'cloudflare',
      publicUrl: 'https://mcp.example.com',
      cloudflare: {
        ownership: 'external',
        authMode: 'access',
        issuer: 'https://team.example.com',
        audience: 'aud',
      },
    });
    assert.ok(access.wiring.verifier instanceof CloudflareAccessVerifier);
    access.db.close();
    const oauth = build({
      provider: 'cloudflare',
      cloudflare: { ownership: 'external', authMode: 'oauth' },
    });
    assert.ok(oauth.wiring.verifier instanceof RejectingIdentityVerifier);
    oauth.db.close();
    const local = build();
    assert.ok(local.wiring.verifier instanceof RejectingIdentityVerifier);
    local.db.close();
  });
  await withEnv(
    { AEVRA_CF_ISSUER: 'https://env.example.com', AEVRA_CF_AUDIENCE: 'env-aud' },
    () => {
      const oauth = build({
        provider: 'cloudflare',
        cloudflare: { ownership: 'external', authMode: 'oauth' },
      });
      assert.ok(oauth.wiring.verifier instanceof CloudflareAccessVerifier);
      oauth.db.close();
      const local = build();
      assert.ok(
        local.wiring.verifier instanceof RejectingIdentityVerifier,
        'env alone never enables Access',
      );
      local.db.close();
    },
  );
});

test('local http gateway lifecycle serves status, validation, and local test results', async () => {
  const h = build({ provider: 'local', localProtocol: 'http' });
  assert.equal(h.wiring.localProtocol(), 'http');
  assert.equal(h.wiring.gatewayUrl(), 'http://localhost:0');
  await assert.rejects(() => h.wiring.startProvider(), /Public gateway is not running/);
  await h.wiring.startGateway('http://127.0.0.1:4101', 'http://127.0.0.1:4102');
  try {
    assert.match(h.wiring.gatewayUrl(), /^http:\/\/127\.0\.0\.1:\d+$/);
    await h.wiring.startProvider();
    const status = h.wiring.status();
    assert.equal(status.restartRequired, false);
    assert.equal(status.adminPublicUrl, undefined);
    assert.deepEqual(status.trustedAdminOrigins, []);
    assert.deepEqual(status.tunnelHealth, { reachable: null, checkedAt: null, message: null });
    assert.equal(h.wiring.publicUrl(), h.wiring.gatewayUrl());
    const local = await h.wiring.test();
    assert.equal(local.provider, 'local');
    assert.equal(local.reachable, true);
    assert.equal(typeof h.wiring.transportValidation(), 'object');
  } finally {
    await h.wiring.close();
    h.db.close();
  }
  assert.equal(h.wiring.gatewayUrl(), 'http://localhost:0');
});

test('external provider starts a watchdog that probes the public health endpoint', async () => {
  const h = build({
    provider: 'external',
    localProtocol: 'http',
    publicUrl: 'https://mcp.example.com/',
  });
  let health: Response | Error = new Response('{}', { status: 200 });
  await withFetch(
    () => {
      if (health instanceof Error) throw health;
      return health.clone();
    },
    async (urls) => {
      await h.wiring.startGateway('http://127.0.0.1:4101', 'http://127.0.0.1:4102');
      try {
        await h.wiring.startProvider();
        assert.deepEqual(await h.wiring.test(), {
          provider: 'external',
          reachable: true,
          state: 'ready',
          publicUrl: 'https://mcp.example.com',
        });
        assert.ok(urls.every((url) => url === 'https://mcp.example.com/health'));
        health = new Response('down', { status: 503 });
        const down = await h.wiring.test();
        assert.equal(down.state, 'error');
        assert.equal(down.message, 'Upstream responded with HTTP 503');
        health = new Error('connect refused');
        assert.equal((await h.wiring.test()).message, 'connect refused');
        assert.equal(h.wiring.status().tunnelHealth.reachable, false);
      } finally {
        await h.wiring.close();
        h.db.close();
      }
    },
  );
});

function bare(controller: any, extra: Record<string, unknown> = {}) {
  const wiring = Object.create(RuntimeExposureWiring.prototype) as any;
  wiring.controller = controller;
  wiring.config = { adminPort: 4101, mcpPort: 4102, publicPort: 4100 };
  Object.assign(wiring, extra);
  return wiring;
}

test('test without a watchdog probes directly and omits empty messages and URLs', async () => {
  const cloudflare = bare(
    {
      status: () => ({ provider: 'cloudflare' }),
      currentConfig: () => ({ provider: 'cloudflare' }),
    },
    { cloudflare: fakeCloudflare({ reachable: true }) },
  );
  assert.deepEqual(await cloudflare.test(), {
    provider: 'cloudflare',
    reachable: true,
    state: 'ready',
  });

  const ngrok = bare({
    status: () => ({ provider: 'ngrok' }),
    currentConfig: () => ({ provider: 'ngrok' }),
  });
  assert.deepEqual(await ngrok.test(), {
    provider: 'ngrok',
    reachable: false,
    state: 'error',
    message: 'Public URL is not configured',
  });

  const throwing = bare({
    status: () => ({ provider: 'external', publicUrl: 'https://mcp.example.com' }),
    currentConfig: () => ({ provider: 'external' }),
  });
  await withFetch(
    () => {
      throw 'plain refusal';
    },
    async () => {
      assert.equal((await throwing.test()).message, 'plain refusal');
    },
  );
});

test('admin URL and trusted origins fall back to bootstrap config when nothing is saved', () => {
  const controller = {
    currentConfig: () => ({ provider: 'local' }),
    status: () => ({ provider: 'local' }),
  };
  const withBootstrap = bare(controller);
  withBootstrap.config = { adminPublicUrl: 'https://boot.example.com' };
  assert.equal(withBootstrap.adminPublicUrl(), 'https://boot.example.com');
  assert.deepEqual(withBootstrap.trustedAdminOrigins(), ['https://boot.example.com']);
  const none = bare(controller);
  none.config = {};
  assert.equal(none.adminPublicUrl(), undefined);
  assert.deepEqual(none.trustedAdminOrigins(), []);
  assert.equal(none.trustForwardedClientIp(), false);
});

test('transport validation falls back to default loopback admin and MCP URLs', () => {
  const wiring = bare({
    currentConfig: () => ({ provider: 'local' }),
    status: () => ({ provider: 'local', restartRequired: false }),
  });
  const result = wiring.transportValidation();
  assert.equal(result.gateway.url, 'https://localhost:4100');
  assert.equal(result.admin.url, 'https://localhost:4101');
  assert.equal(result.mcp.url, 'https://localhost:4102');
  assert.equal(result.public.url, undefined);
});

test('testAdmin reports HTTP failures, foreign health bodies, and thrown errors', async () => {
  const wiring = bare({ currentConfig: () => ({ provider: 'local' }) });
  wiring.config = {};
  wiring.adminPublicUrl = () => 'https://admin.example.com/panel';
  wiring.trustedAdminOrigins = () => [];
  let reply: () => Response = () => new Response('nope', { status: 500 });
  await withFetch(
    () => reply(),
    async (urls) => {
      assert.deepEqual(await wiring.testAdmin(), {
        configured: true,
        trusted: false,
        reachable: false,
        publicUrl: 'https://admin.example.com/panel',
        message: 'Admin endpoint returned HTTP 500',
      });
      assert.equal(urls[0], 'https://admin.example.com/panel/api/health');
      reply = () => new Response(JSON.stringify({ core: 'stopped' }), { status: 200 });
      assert.equal(
        (await wiring.testAdmin()).message,
        'Endpoint did not return Aevra Admin health',
      );
      reply = () => new Response('null', { status: 200 });
      assert.equal(
        (await wiring.testAdmin()).message,
        'Endpoint did not return Aevra Admin health',
      );
      reply = () => {
        throw new Error('redirect refused');
      };
      assert.equal((await wiring.testAdmin()).message, 'redirect refused');
      reply = () => {
        throw 'plain';
      };
      assert.equal((await wiring.testAdmin()).message, 'plain');
      reply = () => new Response(JSON.stringify({ core: 'running' }), { status: 200 });
      const candidate = await wiring.testAdmin({ publicUrl: 'https://cand.example.com' });
      assert.deepEqual(candidate, {
        configured: true,
        trusted: true,
        reachable: true,
        publicUrl: 'https://cand.example.com',
      });
      assert.equal(urls.at(-1), 'https://cand.example.com/api/health');
      assert.equal((await wiring.testAdmin({})).configured, false);
    },
  );
});
