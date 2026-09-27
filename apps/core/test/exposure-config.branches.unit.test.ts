import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadExposureConfig,
  resolveLocalProtocol,
  validateExposureConfig,
} from '../src/exposure/config.js';

function memorySettings(initial: Record<string, unknown> = {}) {
  const values = new Map<string, unknown>(Object.entries(initial));
  return {
    values,
    get<T>(key: string, fallback: T): T {
      return (values.has(key) ? values.get(key) : fallback) as T;
    },
    set(key: string, value: unknown) {
      values.set(key, value);
    },
  };
}

const v = (input: unknown) => validateExposureConfig(input as any);

test('public URLs must parse and use HTTPS; search and hash are dropped', () => {
  assert.throws(() => v({ provider: 'external', publicUrl: 'not a url' }), /valid HTTPS URL/);
  assert.throws(() => v({ provider: 'external', publicUrl: 'http://mcp.example.com' }), /must use HTTPS/);
  assert.deepEqual(v({ provider: 'external', publicUrl: 'https://mcp.example.com/base/?q=1#x' }), {
    provider: 'external',
    publicUrl: 'https://mcp.example.com/base',
  });
});

test('local protocol accepts http/https and rejects anything else', () => {
  assert.equal(resolveLocalProtocol({}), 'https');
  assert.equal(resolveLocalProtocol({ localProtocol: 'http' }), 'http');
  assert.throws(() => resolveLocalProtocol({ localProtocol: 'ftp' as any }), /https or http/);
  assert.throws(() => v({ provider: 'local', localProtocol: 'gopher' }), /https or http/);
});

test('unsupported providers are rejected', () => {
  assert.throws(() => v({ provider: 'carrier-pigeon' }), /Unsupported exposure provider: carrier-pigeon/);
});

test('local config keeps only local fields including trusted proxy and admin values', () => {
  assert.deepEqual(
    v({
      provider: 'local',
      localProtocol: 'http',
      publicUrl: 'https://ignored.example.com',
      adminPublicUrl: 'https://admin.example.com/',
      trustedAdminOrigins: ['https://ops.example.com/path'],
      trustedProxyClientIp: true,
    }),
    {
      provider: 'local',
      localProtocol: 'http',
      adminPublicUrl: 'https://admin.example.com',
      trustedAdminOrigins: ['https://ops.example.com'],
      trustedProxyClientIp: true,
    },
  );
  assert.deepEqual(v({ provider: 'local', trustedProxyClientIp: 'yes' }), { provider: 'local' });
});

test('direct exposure requires https transport, public URL, and a host', () => {
  assert.throws(
    () => v({ provider: 'direct', localProtocol: 'http', publicUrl: 'https://a.example.com' }),
    /requires HTTPS local transport/,
  );
  assert.throws(() => v({ provider: 'direct', direct: { host: '0.0.0.0' } }), /requires a public URL/);
  assert.throws(
    () => v({ provider: 'direct', publicUrl: 'https://a.example.com', direct: { host: '  ' } }),
    /host is required/,
  );
  assert.throws(() => v({ provider: 'direct', publicUrl: 'https://a.example.com' }), /host is required/);
  const ok = v({ provider: 'direct', publicUrl: 'https://a.example.com', direct: { host: ' 0.0.0.0 ' } });
  assert.deepEqual(ok.direct, { host: '0.0.0.0' });
  assert.equal('trustedProxyClientIp' in ok, false);
});

test('external exposure requires a public URL and keeps the local protocol', () => {
  assert.throws(() => v({ provider: 'external' }), /External exposure requires a public URL/);
  assert.deepEqual(
    v({ provider: 'external', localProtocol: 'http', publicUrl: 'https://e.example.com', trustedProxyClientIp: true }),
    { provider: 'external', localProtocol: 'http', publicUrl: 'https://e.example.com', trustedProxyClientIp: true },
  );
});

test('cloudflare exposure validates presence, ownership, auth mode, and Access values', () => {
  assert.throws(() => v({ provider: 'cloudflare' }), /configuration is required/);
  assert.throws(
    () => v({ provider: 'cloudflare', cloudflare: { ownership: 'rented', authMode: 'oauth' } }),
    /ownership must be managed or external/,
  );
  assert.throws(
    () => v({ provider: 'cloudflare', cloudflare: { ownership: 'managed', authMode: 'basic' } }),
    /auth mode must be oauth or access/,
  );
  assert.throws(
    () => v({ provider: 'cloudflare', cloudflare: { ownership: 'managed', authMode: 'access', issuer: 'x', audience: ' ' } }),
    /issuer and audience are required/,
  );
  assert.throws(
    () => v({ provider: 'cloudflare', cloudflare: { ownership: 'managed', authMode: 'access', audience: 'a' } }),
    /issuer and audience are required/,
  );
  const ok = v({
    provider: 'cloudflare',
    cloudflare: { ownership: 'managed', authMode: 'access', issuer: 'x', audience: 'a' },
  });
  assert.equal(ok.cloudflare?.authMode, 'access');
  assert.equal('publicUrl' in ok, false);
});

test('ngrok exposure validates ownership, domain mode, and URL requirements', () => {
  assert.throws(() => v({ provider: 'ngrok' }), /ngrok ownership/);
  assert.throws(() => v({ provider: 'ngrok', ngrok: { ownership: 'leased' } }), /ngrok ownership/);
  assert.throws(
    () => v({ provider: 'ngrok', ngrok: { ownership: 'managed', domainMode: 'vanity' } }),
    /domain mode must be automatic or stable/,
  );
  assert.throws(() => v({ provider: 'ngrok', ngrok: { ownership: 'external' } }), /External ngrok exposure requires/);
  assert.throws(
    () => v({ provider: 'ngrok', ngrok: { ownership: 'managed', domainMode: 'stable' } }),
    /stable domain requires a public URL/,
  );
  assert.deepEqual(v({ provider: 'ngrok', ngrok: { ownership: 'managed', extra: 1 } }).ngrok, {
    ownership: 'managed',
  });
  assert.deepEqual(
    v({ provider: 'ngrok', publicUrl: 'https://n.example.com', ngrok: { ownership: 'managed', domainMode: 'stable' } }).ngrok,
    { ownership: 'managed', domainMode: 'stable' },
  );
});

test('loadExposureConfig prefers stored config, then migrates legacy Cloudflare, else local', () => {
  assert.deepEqual(loadExposureConfig(memorySettings()), { provider: 'local' });
  const stored = memorySettings({ 'exposure.config': { provider: 'external', publicUrl: 'https://s.example.com/' } });
  assert.deepEqual(loadExposureConfig(stored), { provider: 'external', publicUrl: 'https://s.example.com' });

  const legacyAccess = memorySettings({
    'cloudflare.config': {
      hostname: ' mcp.example.com ',
      ownership: 'external',
      authMode: 'access',
      tunnelId: 42,
      issuer: 'https://team.example.com',
      audience: 'aud',
    },
  });
  const migrated = loadExposureConfig(legacyAccess);
  assert.deepEqual(migrated, {
    provider: 'cloudflare',
    publicUrl: 'https://mcp.example.com',
    cloudflare: {
      ownership: 'external',
      authMode: 'access',
      tunnelId: '42',
      hostname: 'mcp.example.com',
      issuer: 'https://team.example.com',
      audience: 'aud',
    },
  });
  assert.deepEqual(legacyAccess.values.get('exposure.config'), migrated);

  const legacyBare = memorySettings({
    'cloudflare.config': { hostname: 7, authMode: 'connector', issuer: 'ignored', audience: 'ignored' },
  });
  assert.deepEqual(loadExposureConfig(legacyBare), {
    provider: 'cloudflare',
    cloudflare: { ownership: 'managed', authMode: 'oauth' },
  });
});
