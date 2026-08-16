import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { SettingsRepository } from '../../../packages/store/src/settings.js';
import { loadExposureConfig, validateExposureConfig } from '../src/exposure/config.js';

function settings() {
  const db = AevraDatabase.open(':memory:');
  return { db, settings: new SettingsRepository(db.raw()) };
}

test('exposure config defaults to local without persisting a synthetic row', () => {
  const fixture = settings();
  try {
    assert.deepEqual(loadExposureConfig(fixture.settings), { provider: 'local' });
    assert.equal(fixture.settings.revision('exposure.config'), 0);
  } finally {
    fixture.db.close();
  }
});

test('legacy managed Cloudflare config migrates once and preserves the legacy row', () => {
  const fixture = settings();
  try {
    const legacy = {
      authMode: 'connector',
      hostname: 'mcp.example.com',
      tunnelId: 'tunnel-1',
      ownership: 'managed',
    };
    fixture.settings.set('cloudflare.config', legacy);

    assert.deepEqual(loadExposureConfig(fixture.settings), {
      provider: 'cloudflare',
      publicUrl: 'https://mcp.example.com',
      cloudflare: {
        tunnelId: 'tunnel-1',
        hostname: 'mcp.example.com',
        ownership: 'managed',
        authMode: 'oauth',
      },
    });
    assert.equal(fixture.settings.revision('exposure.config'), 1);
    assert.deepEqual(fixture.settings.get('cloudflare.config', null), legacy);

    loadExposureConfig(fixture.settings);
    assert.equal(fixture.settings.revision('exposure.config'), 1);
  } finally {
    fixture.db.close();
  }
});

test('legacy Cloudflare Access migration preserves issuer and audience', () => {
  const fixture = settings();
  try {
    fixture.settings.set('cloudflare.config', {
      authMode: 'access',
      hostname: 'aevra.example.com',
      tunnelId: 'tunnel-access',
      ownership: 'external',
      issuer: 'https://team.cloudflareaccess.com',
      audience: 'aud-1',
    });

    assert.deepEqual(loadExposureConfig(fixture.settings), {
      provider: 'cloudflare',
      publicUrl: 'https://aevra.example.com',
      cloudflare: {
        tunnelId: 'tunnel-access',
        hostname: 'aevra.example.com',
        ownership: 'external',
        authMode: 'access',
        issuer: 'https://team.cloudflareaccess.com',
        audience: 'aud-1',
      },
    });
  } finally {
    fixture.db.close();
  }
});

test('exposure validation rejects unknown providers and insecure public URLs', () => {
  assert.throws(
    () => validateExposureConfig({ provider: 'other' } as any),
    /Unsupported exposure provider/,
  );
  assert.throws(
    () =>
      validateExposureConfig({
        provider: 'external',
        publicUrl: 'http://aevra.example.com',
      }),
    /HTTPS/,
  );
});

test('direct exposure requires an HTTPS public URL', () => {
  assert.throws(
    () => validateExposureConfig({ provider: 'direct', direct: { host: '0.0.0.0' } }),
    /public URL/i,
  );
  assert.deepEqual(
    validateExposureConfig({
      provider: 'direct',
      publicUrl: 'https://aevra.example.com',
      direct: { host: '0.0.0.0' },
    }),
    {
      provider: 'direct',
      publicUrl: 'https://aevra.example.com',
      direct: { host: '0.0.0.0' },
    },
  );
});
