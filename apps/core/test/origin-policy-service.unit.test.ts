import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserOriginPolicyService } from '../src/browser/origin-policy-service.js';

function fakeSettings(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    get: <T>(key: string, fallback: T): T => (store.has(key) ? (store.get(key) as T) : fallback),
    set: (key: string, value: unknown) => void store.set(key, value),
    read: (key: string) => store.get(key),
  };
}

const ports = { publicPort: 8443, adminPort: 9000, mcpPort: 9001, browserPort: 9002 };

test('the snapshot carries live ports rather than stored ones', () => {
  const settings = fakeSettings();
  const service = new BrowserOriginPolicyService(settings, () => ports);
  assert.deepEqual(service.snapshot().aevraPorts, [8443, 9000, 9001, 9002]);
});

test('loopbackClass defaults to SENSITIVE', () => {
  const service = new BrowserOriginPolicyService(fakeSettings(), () => ports);
  assert.equal(service.snapshot().loopbackClass, 'SENSITIVE');
});

test('an update persists and is reflected in the next snapshot', () => {
  const settings = fakeSettings();
  const service = new BrowserOriginPolicyService(settings, () => ports);
  service.update({ loopbackClass: 'NORMAL', sensitiveHosts: ['intranet.test'] });
  assert.equal(service.snapshot().loopbackClass, 'NORMAL');
  assert.deepEqual(service.snapshot().sensitiveHosts, ['intranet.test']);
  assert.deepEqual(settings.read('browser.originPolicy'), {
    loopbackClass: 'NORMAL',
    blockedHosts: [],
    sensitiveHosts: ['intranet.test'],
  });
});

test('an unknown loopbackClass is rejected rather than stored', () => {
  const service = new BrowserOriginPolicyService(fakeSettings(), () => ports);
  assert.throws(() => service.update({ loopbackClass: 'OPEN' as never }), /loopbackClass/);
});

test('a stored value that is no longer valid falls back to SENSITIVE', () => {
  const settings = fakeSettings({ 'browser.originPolicy': { loopbackClass: 'OPEN' } });
  const service = new BrowserOriginPolicyService(settings, () => ports);
  assert.equal(service.snapshot().loopbackClass, 'SENSITIVE');
});

test('ports are re-read on every snapshot so a restart on new ports is not stale', () => {
  let current = ports;
  const service = new BrowserOriginPolicyService(fakeSettings(), () => current);
  current = { ...ports, adminPort: 12345 };
  assert.ok(service.snapshot().aevraPorts.includes(12345));
});
