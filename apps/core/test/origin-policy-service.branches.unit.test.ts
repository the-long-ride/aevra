import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserOriginPolicyService } from '../src/browser/origin-policy-service.js';

function settings(initial?: unknown) {
  const store = new Map<string, unknown>();
  if (initial !== undefined) store.set('browser.originPolicy', initial);
  return { store, get: (k: string, f: unknown) => (store.has(k) ? store.get(k) : f) as any, set: (k: string, v: unknown) => void store.set(k, v) };
}
const ports = () => ({ publicPort: 1, adminPort: 2, mcpPort: 3, browserPort: 4 });

test('origin policy sanitizes stored values and origin resolvers', () => {
  const bad = new BrowserOriginPolicyService(settings({ loopbackClass: 'OPEN', blockedHosts: ['a', 5], sensitiveHosts: 'x' }), ports);
  assert.deepEqual(bad.snapshot(), {
    loopbackClass: 'SENSITIVE',
    blockedHosts: ['a'],
    sensitiveHosts: [],
    aevraPorts: [1, 2, 3, 4],
    aevraOrigins: [],
  });
  assert.equal(new BrowserOriginPolicyService(settings(null), ports).stored().loopbackClass, 'SENSITIVE');
  const listed = new BrowserOriginPolicyService(settings(), ports, () => [' HTTPS://A.example ', 'https://a.example', undefined, '  ']);
  assert.deepEqual(listed.snapshot().aevraOrigins, ['https://a.example']);
  const throwing = new BrowserOriginPolicyService(settings(), ports, () => {
    throw new Error('not ready');
  });
  assert.deepEqual(throwing.snapshot().aevraOrigins, []);
  assert.deepEqual(new BrowserOriginPolicyService(settings(), ports, () => null as any).snapshot().aevraOrigins, []);
});

test('origin policy update validates the class and merges only provided fields', () => {
  const s = settings({ loopbackClass: 'BLOCKED', blockedHosts: ['a'], sensitiveHosts: ['b'] });
  const service = new BrowserOriginPolicyService(s, ports);
  assert.throws(() => service.update({ loopbackClass: 'OPEN' as any }), (e: any) => e.code === 'ORIGIN_POLICY_INVALID' && e.status === 400);
  assert.deepEqual(service.update({}), { loopbackClass: 'BLOCKED', blockedHosts: ['a'], sensitiveHosts: ['b'] });
  assert.deepEqual(service.update({ loopbackClass: 'NORMAL', blockedHosts: ['c', 1 as any], sensitiveHosts: [] }), {
    loopbackClass: 'NORMAL',
    blockedHosts: ['c'],
    sensitiveHosts: [],
  });
  assert.deepEqual(s.store.get('browser.originPolicy'), { loopbackClass: 'NORMAL', blockedHosts: ['c'], sensitiveHosts: [] });
});
