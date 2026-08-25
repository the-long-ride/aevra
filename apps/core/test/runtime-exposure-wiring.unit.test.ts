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
