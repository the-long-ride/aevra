import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { SettingsRepository } from '../../../packages/store/src/settings.js';
import {
  CloudflareManagerImpl,
  normalizePublicHostname,
  resolveCloudflareAuthMode,
} from '../src/cloudflare/manager.js';

const TUNNEL = '11111111-1111-1111-1111-111111111111';

function harness(cliOverrides: Record<string, unknown> = {}) {
  const db = AevraDatabase.open(':memory:');
  const settings = new SettingsRepository(db.raw());
  const calls: unknown[][] = [];
  const cli: any = {
    async version() {
      return { found: true, version: 'x' };
    },
    async createTunnel(name: string) {
      calls.push(['create', name]);
      return { code: 0, stdout: `Created tunnel ${TUNNEL}`, stderr: '' };
    },
    async routeDns(id: string, host: string) {
      calls.push(['route', id, host]);
      return { code: 0, stdout: '', stderr: '' };
    },
    ...cliOverrides,
  };
  return { db, settings, calls, cli, manager: new CloudflareManagerImpl(settings, cli) };
}

class FakeChild extends EventEmitter {
  killed = false;
  signals: string[] = [];
  kill(signal: string) {
    this.signals.push(signal);
    this.killed = true;
    return true;
  }
}

test('resolveCloudflareAuthMode honors explicit access and tolerates missing config', () => {
  assert.equal(resolveCloudflareAuthMode({ authMode: 'access' }), 'access');
  assert.equal(resolveCloudflareAuthMode(undefined), 'connector');
  assert.equal(resolveCloudflareAuthMode({ issuer: 'only-issuer' }), 'connector');
});

test('normalizePublicHostname rejects malformed URLs, fragments, bad labels, and bare names', () => {
  const cases: Array<[string, RegExp]> = [
    ['https://[bad', /URL is invalid/],
    ['https://mcp.example.com/#frag', /path, query, or fragment/],
    ['https://:word@mcp.example.com', /credentials/],
    ['intranet', /valid public DNS hostname/],
    [`${'a'.repeat(250)}.com`, /valid public DNS hostname/],
    ['bad_label.example.com', /valid public DNS hostname/],
    ['-lead.example.com', /valid public DNS hostname/],
    [`${'a'.repeat(64)}.example.com`, /valid public DNS hostname/],
    ['https://127.0.0.1', /public DNS hostname/],
    ['::1', /hostname-only https URL/],
  ];
  for (const [input, pattern] of cases) assert.throws(() => normalizePublicHostname(input), pattern, input);
  assert.throws(() => normalizePublicHostname(undefined as any), /required/);
  assert.equal(normalizePublicHostname('MCP.Example.com.'), 'mcp.example.com');
});

test('status reports unconfigured, external, stopped, and running states', async () => {
  const h = harness();
  assert.deepEqual(await h.manager.status(), {
    state: 'unconfigured',
    message: 'Cloudflare hostname is not configured',
  });
  h.settings.set('cloudflare.config', { hostname: 'mcp.example.com', tunnelId: TUNNEL });
  assert.deepEqual(await h.manager.status(), { state: 'stopped' });
  const child = new FakeChild();
  h.cli.spawnTunnel = () => child;
  await h.manager.startManagedTunnel();
  assert.deepEqual(await h.manager.status(), { state: 'running' });
  await h.manager.stopManagedTunnel();
  assert.deepEqual(child.signals, ['SIGTERM']);
  h.settings.set('cloudflare.ownership', 'external');
  assert.deepEqual(await h.manager.status(), { state: 'external' });
  h.db.close();
});

test('authenticationStatus handles missing binary, thrown errors, and empty failure output', async () => {
  const missing = harness({ version: async () => ({ found: false }) });
  assert.deepEqual(await missing.manager.authenticationStatus(), {
    authenticated: false,
    message: 'cloudflared is not installed',
  });
  missing.db.close();

  const thrown = harness({
    listTunnels: async () => {
      throw new Error('spawn failed');
    },
  });
  assert.deepEqual(await thrown.manager.authenticationStatus(), {
    authenticated: false,
    message: 'spawn failed',
  });
  thrown.cli.listTunnels = async () => {
    throw 'plain failure';
  };
  assert.equal((await thrown.manager.authenticationStatus()).message, 'plain failure');
  thrown.cli.listTunnels = async () => ({ code: 1, stdout: ' stdout reason ', stderr: '' });
  assert.equal((await thrown.manager.authenticationStatus()).message, 'stdout reason');
  thrown.cli.listTunnels = async () => ({ code: 1, stdout: '', stderr: '' });
  assert.equal(
    (await thrown.manager.authenticationStatus()).message,
    'Cloudflare login is not available',
  );
  thrown.db.close();
});

test('setup refuses when cloudflared is missing', async () => {
  const h = harness({ version: async () => ({ found: false }) });
  await assert.rejects(() => h.manager.setup({ hostname: 'mcp.example.com' }), /cloudflared not found/);
  assert.deepEqual(h.calls, []);
  h.db.close();
});

test('setup creates a tunnel when none is given and reuses stored Access verifier values', async () => {
  const h = harness();
  h.settings.set('cloudflare.issuer', ' https://team.example.com ');
  h.settings.set('cloudflare.audience', 'stored-aud');
  const result = await h.manager.setup({
    hostname: 'mcp.example.com',
    authMode: 'access',
    ownership: 'external',
  });
  assert.deepEqual(result, {
    authMode: 'access',
    hostname: 'mcp.example.com',
    tunnelId: TUNNEL,
    ownership: 'external',
    issuer: 'https://team.example.com',
    audience: 'stored-aud',
  });
  assert.deepEqual(h.calls, [['create', 'aevra'], ['route', TUNNEL, 'mcp.example.com']]);
  assert.equal(h.settings.get('cloudflare.ownership', ''), 'external');
  assert.equal(h.settings.get('cloudflare.audience', ''), 'stored-aud');
  h.db.close();
});

test('setup infers auth mode from existing config and input verifier values', async () => {
  const h = harness();
  h.settings.set('cloudflare.config', { issuer: 'https://old.example.com', audience: 'old' });
  const fromExisting = await h.manager.setup({ hostname: 'mcp.example.com', tunnelId: ' tid ' });
  assert.equal(fromExisting.authMode, 'access');
  assert.equal(fromExisting.tunnelId, 'tid');
  assert.equal(fromExisting.issuer, 'https://old.example.com');
  const fromInput = await h.manager.setup({
    hostname: 'mcp.example.com',
    tunnelId: 'tid',
    issuer: 'https://new.example.com',
    audience: 'new',
  });
  assert.equal(fromInput.authMode, 'access');
  assert.equal(fromInput.audience, 'new');
  h.db.close();
});

test('setup surfaces tunnel creation and DNS route failures but tolerates existing routes', async () => {
  const failCreate = harness({ createTunnel: async () => ({ code: 1, stdout: '', stderr: 'quota' }) });
  await assert.rejects(
    () => failCreate.manager.setup({ hostname: 'mcp.example.com', authMode: 'connector' }),
    /tunnel create failed: quota/,
  );
  failCreate.cli.createTunnel = async () => ({ code: 0, stdout: 'no id here', stderr: '' });
  await assert.rejects(
    () => failCreate.manager.setup({ hostname: 'mcp.example.com', authMode: 'connector' }),
    /Could not parse tunnel ID/,
  );
  assert.equal(failCreate.settings.get('cloudflare.config', null), null);
  failCreate.db.close();

  const route = harness({ routeDns: async () => ({ code: 1, stdout: '', stderr: 'denied' }) });
  await assert.rejects(
    () => route.manager.setup({ hostname: 'mcp.example.com', tunnelId: 'tid', authMode: 'connector' }),
    /DNS route failed: denied/,
  );
  route.cli.routeDns = async () => ({ code: 1, stdout: '', stderr: 'record Already Exists' });
  const ok = await route.manager.setup({ hostname: 'mcp.example.com', tunnelId: 'tid', authMode: 'connector' });
  assert.equal(ok.tunnelId, 'tid');
  route.db.close();
});

test('start validates the gateway origin and returns the public URL when configured', async () => {
  const h = harness();
  const origins: string[] = [];
  h.cli.spawnTunnel = (_id: string, origin: string) => {
    origins.push(origin);
    return new FakeChild();
  };
  for (const bad of ['not a url', 'ftp://localhost:1', 'https://example.com']) {
    await assert.rejects(() => h.manager.start(bad), /loopback HTTP or HTTPS/, bad);
  }
  await assert.rejects(() => h.manager.start('http://127.0.0.1:9000/'), /not configured/);
  h.settings.set('cloudflare.config', { tunnelId: TUNNEL });
  assert.deepEqual(await h.manager.start('http://127.0.0.1:9000/'), {});
  await h.manager.stop();
  h.settings.set('cloudflare.config', { tunnelId: TUNNEL, hostname: 'mcp.example.com' });
  assert.deepEqual(await h.manager.start('https://[::1]:9443'), { publicUrl: 'https://mcp.example.com' });
  assert.deepEqual(origins, ['http://127.0.0.1:9000', 'https://[::1]:9443']);
  await h.manager.stop();
  h.db.close();
});

test('startManagedTunnel is idempotent while a child is alive', async () => {
  const h = harness();
  h.settings.set('cloudflare.config', { tunnelId: TUNNEL });
  let spawns = 0;
  h.cli.spawnTunnel = () => {
    spawns++;
    return new FakeChild();
  };
  await h.manager.startManagedTunnel();
  await h.manager.startManagedTunnel();
  assert.equal(spawns, 1);
  await h.manager.stopManagedTunnel();
  await h.manager.stopManagedTunnel();
  h.db.close();
});
