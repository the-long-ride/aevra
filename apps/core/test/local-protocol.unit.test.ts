import assert from 'node:assert/strict';
import test from 'node:test';
import { validateExposureConfig } from '../src/exposure/config.js';
import { PublicGateway } from '../src/gateway/public-gateway.js';

test('local transport accepts HTTP while defaulting legacy configs to HTTPS behavior', () => {
  assert.deepEqual(validateExposureConfig({ provider: 'local', localProtocol: 'http' } as any), {
    provider: 'local',
    localProtocol: 'http',
  });
  assert.deepEqual(validateExposureConfig({ provider: 'local' }), { provider: 'local' });
});

test('direct exposure rejects HTTP local transport', () => {
  assert.throws(
    () =>
      validateExposureConfig({
        provider: 'direct',
        localProtocol: 'http',
        publicUrl: 'https://aevra.example.com',
        direct: { host: '0.0.0.0' },
      } as any),
    /HTTPS/i,
  );
});

test('public gateway URL uses the configured local transport protocol', () => {
  const gateway = new PublicGateway({
    host: '127.0.0.1',
    port: 47830,
    protocol: 'http',
    targets: {
      adminUrl: 'http://127.0.0.1:47831',
      mcpUrl: 'http://127.0.0.1:47832',
    },
  } as any);

  assert.equal(gateway.url(), 'http://127.0.0.1:47830');
});
