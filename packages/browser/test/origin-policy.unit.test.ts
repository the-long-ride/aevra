import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyOrigin, DEFAULT_ORIGIN_POLICY } from '../src/origin-policy.js';

test('a configured Aevra port is BLOCKED even though it is not a default', () => {
  assert.equal(
    classifyOrigin('http://127.0.0.1:9000/', { aevraPorts: [9000], loopbackClass: 'NORMAL' }),
    'BLOCKED',
  );
});

test('a default port that is no longer an Aevra listener is not BLOCKED for that reason', () => {
  assert.equal(
    classifyOrigin('http://127.0.0.1:47831/', { aevraPorts: [9000], loopbackClass: 'NORMAL' }),
    'NORMAL',
  );
});

test('loopbackClass decides every other loopback origin', () => {
  for (const loopbackClass of ['BLOCKED', 'SENSITIVE', 'NORMAL'] as const) {
    assert.equal(
      classifyOrigin('http://localhost:3000/', { aevraPorts: [47831], loopbackClass }),
      loopbackClass,
      `localhost:3000 under ${loopbackClass}`,
    );
  }
});

test('loopbackClass NORMAL cannot unblock an Aevra port', () => {
  assert.equal(
    classifyOrigin('http://localhost:47831/', { aevraPorts: [47831], loopbackClass: 'NORMAL' }),
    'BLOCKED',
  );
});

test('every loopback spelling is covered', () => {
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    assert.equal(classifyOrigin(`http://${host}:47831/`, { aevraPorts: [47831] }), 'BLOCKED', host);
  }
});

test('a password field still outranks the loopback rule', () => {
  assert.equal(
    classifyOrigin('http://localhost:3000/login', {
      aevraPorts: [47831],
      loopbackClass: 'NORMAL',
      hasPasswordField: true,
    }),
    'SENSITIVE',
  );
});

test('a non-loopback origin is unaffected by loopbackClass', () => {
  assert.equal(classifyOrigin('https://example.com/', { loopbackClass: 'BLOCKED' }), 'NORMAL');
});

test('the default policy is SENSITIVE for loopback', () => {
  assert.equal(DEFAULT_ORIGIN_POLICY.loopbackClass, 'SENSITIVE');
  assert.equal(classifyOrigin('http://localhost:3000/'), 'SENSITIVE');
});

test('a blocked scheme still wins over any loopback rule', () => {
  assert.equal(classifyOrigin('chrome://settings', { loopbackClass: 'NORMAL' }), 'BLOCKED');
});

test('a sensitive host entry covers its subdomains', () => {
  assert.equal(
    classifyOrigin('https://app.example.com/', { sensitiveHosts: ['example.com'] }),
    'SENSITIVE',
  );
});

test('the bank pattern reads the host, not the path', () => {
  assert.equal(classifyOrigin('https://example.com/bankruptcy-guide'), 'NORMAL');
  assert.equal(classifyOrigin('https://bankofamerica.com/'), 'SENSITIVE');
  assert.equal(classifyOrigin('https://secure.mybank.co.uk/'), 'SENSITIVE');
});

test('a route-identified sensitive surface still matches on its path', () => {
  assert.equal(classifyOrigin('https://github.com/settings/tokens'), 'SENSITIVE');
  assert.equal(classifyOrigin('https://github.com/some/repo'), 'NORMAL');
});
