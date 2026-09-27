import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test, { mock } from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { SettingsRepository } from '../../../packages/store/src/settings.js';
import { CloudflareManagerImpl } from '../src/cloudflare/manager.js';

const TUNNEL = '11111111-1111-1111-1111-111111111111';
const BASE = 'https://mcp.example.com';

class FakeChild extends EventEmitter {
  killed = false;
  kill() {
    this.killed = true;
    return true;
  }
}

function harness() {
  const db = AevraDatabase.open(':memory:');
  const settings = new SettingsRepository(db.raw());
  const children: FakeChild[] = [];
  const cli: any = {
    spawnTunnel() {
      const child = new FakeChild();
      children.push(child);
      return child;
    },
  };
  return { db, settings, children, manager: new CloudflareManagerImpl(settings, cli) };
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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function configured() {
  const h = harness();
  h.settings.set('cloudflare.config', { hostname: 'mcp.example.com', tunnelId: TUNNEL });
  return h;
}

test('checkReachability reports missing hostname without fetching', async () => {
  const h = harness();
  await withFetch(
    () => json({}),
    async (urls) => {
      assert.deepEqual(await h.manager.checkReachability(), {
        reachable: false,
        message: 'Cloudflare hostname is not configured',
      });
      assert.deepEqual(urls, []);
    },
  );
  h.db.close();
});

test('checkReachability reports failed health and failed discovery status codes', async () => {
  const h = configured();
  await withFetch(
    () => new Response('down', { status: 502 }),
    async (urls) => {
      assert.deepEqual(await h.manager.checkReachability(), {
        reachable: false,
        status: 502,
        message: 'Health check failed: HTTP 502',
      });
      assert.deepEqual(urls, [`${BASE}/health`]);
    },
  );
  await withFetch(
    (url) => (url.endsWith('/health') ? json({ ok: true }) : new Response('nope', { status: 404 })),
    async (urls) => {
      assert.deepEqual(await h.manager.checkReachability(), {
        reachable: false,
        status: 404,
        message: 'OAuth discovery failed: HTTP 404',
      });
      assert.deepEqual(urls, [`${BASE}/health`, `${BASE}/.well-known/oauth-protected-resource/mcp`]);
    },
  );
  h.db.close();
});

test('checkReachability validates discovery JSON, resource, and authorization servers', async () => {
  const h = configured();
  const cases: Array<[() => Response, string]> = [
    [() => new Response('not json', { status: 200 }), 'OAuth discovery failed: invalid JSON'],
    [
      () => json({ resource: 'https://other.example.com/mcp' }),
      `OAuth discovery resource mismatch: expected ${BASE}/mcp`,
    ],
    [
      () => json({ resource: `${BASE}/mcp`, authorization_servers: 'not-a-list' }),
      `OAuth discovery authorization server mismatch: expected ${BASE}`,
    ],
    [
      () => json({ resource: `${BASE}/mcp`, authorization_servers: ['https://other.example.com'] }),
      `OAuth discovery authorization server mismatch: expected ${BASE}`,
    ],
    [() => json(null), `OAuth discovery resource mismatch: expected ${BASE}/mcp`],
  ];
  for (const [metadata, message] of cases) {
    await withFetch(
      (url) => (url.endsWith('/health') ? json({ ok: true }) : metadata()),
      async () => {
        assert.deepEqual(await h.manager.checkReachability(), { reachable: false, status: 200, message });
      },
    );
  }
  await withFetch(
    (url) =>
      url.endsWith('/health')
        ? json({ ok: true })
        : json({ resource: `${BASE}/mcp`, authorization_servers: [BASE] }),
    async () => {
      assert.deepEqual(await h.manager.checkReachability(), {
        reachable: true,
        status: 200,
        message: 'reachable; OAuth discovery ready',
      });
    },
  );
  h.db.close();
});

test('checkReachability converts thrown fetch errors into unreachable results', async () => {
  const h = configured();
  await withFetch(
    () => {
      throw new Error('getaddrinfo failure');
    },
    async () => {
      assert.deepEqual(await h.manager.checkReachability(), {
        reachable: false,
        message: 'getaddrinfo failure',
      });
    },
  );
  await withFetch(
    () => {
      throw 'string failure';
    },
    async () => {
      assert.deepEqual(await h.manager.checkReachability(), {
        reachable: false,
        message: 'string failure',
      });
    },
  );
  h.db.close();
});

test('managed tunnel restarts with backoff after an unexpected exit and resets when stable', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const h = configured();
  await h.manager.startManagedTunnel();
  assert.equal(h.children.length, 1);

  h.children[0].emit('exit', 1);
  assert.deepEqual(await h.manager.status(), { state: 'stopped' });
  mock.timers.tick(999);
  assert.equal(h.children.length, 1);
  mock.timers.tick(1);
  await Promise.resolve();
  assert.equal(h.children.length, 2, 'first restart after 1s');

  h.children[1].emit('exit', 1);
  mock.timers.tick(1999);
  assert.equal(h.children.length, 2);
  mock.timers.tick(1);
  await Promise.resolve();
  assert.equal(h.children.length, 3, 'second restart after 2s');

  mock.timers.tick(60_000);
  h.children[2].emit('exit', 1);
  mock.timers.tick(1000);
  await Promise.resolve();
  assert.equal(h.children.length, 4, 'stable run resets the backoff to 1s');

  await h.manager.stopManagedTunnel();
  assert.equal(h.children[3].killed, true);
  h.children[3].emit('exit', 0);
  mock.timers.tick(120_000);
  await Promise.resolve();
  assert.equal(h.children.length, 4, 'intentional stop never restarts');
  h.db.close();
});

test('managed tunnel does not restart when ownership turns external and swallows restart errors', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const h = configured();
  await h.manager.startManagedTunnel();
  h.settings.set('cloudflare.ownership', 'external');
  h.children[0].emit('exit', 1);
  mock.timers.tick(120_000);
  assert.equal(h.children.length, 1);

  h.settings.set('cloudflare.ownership', 'managed');
  await h.manager.startManagedTunnel();
  assert.equal(h.children.length, 2);
  h.settings.set('cloudflare.config', { hostname: 'mcp.example.com' });
  h.children[1].emit('exit', 1);
  mock.timers.tick(60_000);
  await Promise.resolve();
  assert.equal(h.children.length, 2, 'restart without a tunnel id fails quietly');
  await h.manager.stopManagedTunnel();
  h.db.close();
});
