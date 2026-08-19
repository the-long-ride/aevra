import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { SettingsRepository } from '../../../packages/store/src/settings.js';
import {
  CloudflareManagerImpl,
  normalizePublicHostname,
  resolveCloudflareAuthMode,
} from '../src/cloudflare/manager.js';

function harness() {
  const db = AevraDatabase.open(':memory:');
  const settings = new SettingsRepository(db.raw());
  const calls: any[] = [];
  const cli: any = {
    async version() {
      return { found: true, version: 'x' };
    },
    async login() {
      calls.push(['login']);
      return { code: 0, stdout: 'ok', stderr: '' };
    },
    async createTunnel() {
      calls.push(['create']);
      return { code: 0, stdout: 'Created tunnel 11111111-1111-1111-1111-111111111111', stderr: '' };
    },
    async routeDns(id: string, h: string) {
      calls.push(['route', id, h]);
      return { code: 0, stdout: '', stderr: '' };
    },
    spawnTunnel() {
      throw new Error('not used');
    },
  };
  return { db, settings, calls, cli, manager: new CloudflareManagerImpl(settings, cli) };
}

test('connector setup needs no Access values and normalizes an https URL hostname', async () => {
  const h = harness();
  h.settings.set('cloudflare.issuer', 'https://stale.cloudflareaccess.com');
  h.settings.set('cloudflare.audience', 'stale-aud');
  const result = await h.manager.setup({
    authMode: 'connector',
    hostname: 'https://mcp.example.com',
    tunnelId: '11111111-1111-1111-1111-111111111111',
  });
  assert.deepEqual(result, {
    authMode: 'connector',
    hostname: 'mcp.example.com',
    tunnelId: '11111111-1111-1111-1111-111111111111',
    ownership: 'managed',
  });
  assert.deepEqual(h.calls, [['route', '11111111-1111-1111-1111-111111111111', 'mcp.example.com']]);
  assert.equal(h.settings.get('cloudflare.issuer', ''), '');
  assert.equal(h.settings.get('cloudflare.audience', ''), '');
  assert.equal(h.settings.get<any>('cloudflare.config', null).authMode, 'connector');
  h.db.close();
});

test('Access setup requires both verifier values before mutating Cloudflare', async () => {
  const h = harness();
  await assert.rejects(
    () =>
      h.manager.setup({
        authMode: 'access',
        hostname: 'mcp.example.com',
        tunnelId: '11111111-1111-1111-1111-111111111111',
      }),
    /issuer and audience are required/i,
  );
  assert.deepEqual(h.calls, []);
  const result = await h.manager.setup({
    authMode: 'access',
    hostname: 'mcp.example.com',
    tunnelId: '11111111-1111-1111-1111-111111111111',
    issuer: 'https://team.cloudflareaccess.com',
    audience: 'aud',
  });
  assert.equal(result.authMode, 'access');
  assert.equal(result.issuer, 'https://team.cloudflareaccess.com');
  assert.equal(result.audience, 'aud');
  h.db.close();
});

test('auth mode resolves old configurations without breaking existing Access setups', () => {
  assert.equal(
    resolveCloudflareAuthMode({ issuer: 'https://team.cloudflareaccess.com', audience: 'aud' }),
    'access',
  );
  assert.equal(resolveCloudflareAuthMode({ hostname: 'mcp.example.com' }), 'connector');
  assert.equal(
    resolveCloudflareAuthMode({ authMode: 'connector', issuer: 'stale', audience: 'stale' }),
    'connector',
  );
});

test('public hostname normalization accepts host or hostname-only https URL', () => {
  assert.equal(normalizePublicHostname('mcp.example.com'), 'mcp.example.com');
  assert.equal(normalizePublicHostname(' HTTPS://MCP.Example.COM/ '), 'mcp.example.com');
  for (const invalid of [
    'http://mcp.example.com',
    'https://mcp.example.com/path',
    'https://mcp.example.com?x=1',
    'https://mcp.example.com:8443',
    'https://user@mcp.example.com',
    'localhost',
    '127.0.0.1',
    'mcp.example.com/path',
    '',
  ]) {
    assert.throws(
      () => normalizePublicHostname(invalid),
      /hostname|https|path|port|public/i,
      invalid,
    );
  }
});

test('setup rejects unknown authentication and ownership modes before Cloudflare mutation', async () => {
  const h = harness();
  await assert.rejects(
    () =>
      h.manager.setup({ hostname: 'mcp.example.com', authMode: 'bogus' as any, tunnelId: 'tid' }),
    /authentication mode/i,
  );
  await assert.rejects(
    () =>
      h.manager.setup({
        hostname: 'mcp.example.com',
        authMode: 'connector',
        ownership: 'bogus' as any,
        tunnelId: 'tid',
      }),
    /ownership/i,
  );
  assert.deepEqual(h.calls, []);
  h.db.close();
});

test('external ownership never spawns or stops managed tunnel', async () => {
  const h = harness();
  h.settings.set('cloudflare.ownership', 'external');
  let spawns = 0;
  const m = new CloudflareManagerImpl(h.settings, {
    async version() {
      return { found: true };
    },
    spawnTunnel() {
      spawns++;
      return {};
    },
  } as any);
  await m.startManagedTunnel();
  await m.stopManagedTunnel();
  assert.equal(spawns, 0);
  h.db.close();
});

test('managed tunnel uses HTTPS loopback origin without remote TLS downgrade', async () => {
  const h = harness();
  h.settings.set('cloudflare.config', { tunnelId: '11111111-1111-1111-1111-111111111111' });
  let call: any;
  const child: any = {
    once() {},
    killed: false,
    kill() {
      this.killed = true;
    },
  };
  const m = new CloudflareManagerImpl(
    h.settings,
    {
      spawnTunnel(id: string, origin: string) {
        call = [id, origin];
        return child;
      },
    } as any,
    'https://localhost:47832',
  );
  await m.startManagedTunnel();
  assert.deepEqual(call, ['11111111-1111-1111-1111-111111111111', 'https://localhost:47832']);
  await m.stopManagedTunnel();
  h.db.close();
});

test('existing Cloudflare login is detected with tunnel list and authenticate does not overwrite cert.pem', async () => {
  const h = harness();
  let logins = 0;
  h.cli.listTunnels = async () => {
    h.calls.push(['list']);
    return { code: 0, stdout: 'ID NAME', stderr: '' };
  };
  h.cli.login = async () => {
    logins++;
    return { code: 0, stdout: 'logged in', stderr: '' };
  };
  const status = await h.manager.authenticationStatus();
  assert.deepEqual(status, { authenticated: true, message: 'Existing Cloudflare login is valid' });
  const result = await h.manager.authenticate();
  assert.equal(result.code, 0);
  assert.match(result.stdout, /already authenticated/i);
  assert.equal(logins, 0);
  assert.deepEqual(h.calls, [['list'], ['list']]);
  h.db.close();
});

test('Cloudflare authenticate runs login only when tunnel list says credentials are unavailable', async () => {
  const h = harness();
  let logins = 0;
  h.cli.listTunnels = async () => ({
    code: 1,
    stdout: '',
    stderr: 'Cannot determine default origin certificate path',
  });
  h.cli.login = async () => {
    logins++;
    return { code: 0, stdout: 'login complete', stderr: '' };
  };
  const before = await h.manager.authenticationStatus();
  assert.equal(before.authenticated, false);
  const result = await h.manager.authenticate();
  assert.equal(result.code, 0);
  assert.equal(logins, 1);
  h.db.close();
});
