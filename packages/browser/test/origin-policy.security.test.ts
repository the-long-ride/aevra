import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyOrigin, registrableDomain, riskForOperation } from '../src/origin-policy.js';

test('privileged browser surfaces are BLOCKED', () => {
  for (const url of [
    'chrome://settings',
    'chrome-extension://abcdefghijklmnop/options.html',
    'devtools://devtools/bundled/inspector.html',
    'file:///C:/Users/me/.ssh/id_rsa',
    'view-source:https://example.com',
    'edge://extensions',
  ]) {
    assert.equal(classifyOrigin(url), 'BLOCKED', url);
  }
});

test('the Aevra admin UI is BLOCKED so the agent cannot re-permission itself', () => {
  assert.equal(classifyOrigin('https://localhost:47831/settings'), 'BLOCKED');
  assert.equal(classifyOrigin('https://127.0.0.1:47830/mcp'), 'BLOCKED');
});

test('every spelling a browser routes to loopback reaches the Aevra port rule', () => {
  // Each of these resolves to this machine in a real browser, and each one
  // classified NORMAL while the loopback test was four exact strings.
  for (const host of [
    'admin.localhost',
    'anything.else.localhost',
    '127.0.0.2',
    '127.99.1.5',
    '0.0.0.0',
    '[::ffff:127.0.0.1]',
    '[::]',
    '2130706433',
    '127.1',
    '0x7f.0.0.1',
  ]) {
    assert.equal(
      classifyOrigin(`http://${host}:47831/settings`, { aevraPorts: [47831] }),
      'BLOCKED',
      host,
    );
  }
});

test('an empty aevraPorts array is a missing answer, not permission', () => {
  assert.equal(
    classifyOrigin('http://127.0.0.1:47831/', { aevraPorts: [], loopbackClass: 'NORMAL' }),
    'BLOCKED',
  );
});

test('an operator who blocks loopback is not downgraded by a password field', () => {
  assert.equal(
    classifyOrigin('http://localhost:3000/login', {
      loopbackClass: 'BLOCKED',
      hasPasswordField: true,
    }),
    'BLOCKED',
  );
  assert.equal(classifyOrigin('http://localhost:3000/', { loopbackClass: 'BLOCKED' }), 'BLOCKED');
});

test('a blocked host entry covers its subdomains', () => {
  assert.equal(
    classifyOrigin('https://admin.internal.example.com/', { blockedHosts: ['example.com'] }),
    'BLOCKED',
  );
});

test('known money and identity origins are SENSITIVE', () => {
  assert.equal(classifyOrigin('https://mail.google.com/mail/u/0'), 'SENSITIVE');
  assert.equal(classifyOrigin('https://console.aws.amazon.com/'), 'SENSITIVE');
  assert.equal(classifyOrigin('https://login.microsoftonline.com/'), 'SENSITIVE');
});

test('an ordinary site is NORMAL', () => {
  assert.equal(classifyOrigin('https://example.com/docs'), 'NORMAL');
});

test('a page reporting a password field is SENSITIVE regardless of host', () => {
  assert.equal(
    classifyOrigin('https://example.com/login', { hasPasswordField: true }),
    'SENSITIVE',
  );
});

test('an unparseable url is BLOCKED, never NORMAL', () => {
  assert.equal(classifyOrigin('not a url'), 'BLOCKED');
  assert.equal(classifyOrigin(''), 'BLOCKED');
});

test('registrableDomain strips subdomains', () => {
  assert.equal(registrableDomain('https://a.b.example.com/x'), 'example.com');
  assert.equal(registrableDomain('https://example.co.uk/x'), 'example.co.uk');
});

test('any operation on a BLOCKED origin is denied, never ticketed', () => {
  const decision = riskForOperation({
    kind: 'browser.snapshot',
    originClass: 'BLOCKED',
    firstVisitToDomain: false,
  });
  assert.deepEqual(decision, { decision: 'deny', risk: 'CRITICAL' });
});

test('any operation on a SENSITIVE origin is HIGH', () => {
  for (const kind of ['browser.snapshot', 'browser.read', 'browser.act'] as const) {
    assert.deepEqual(
      riskForOperation({ kind, originClass: 'SENSITIVE', firstVisitToDomain: false }),
      {
        decision: 'allow',
        risk: 'HIGH',
      },
    );
  }
});

test('reads are LOW and acts are MEDIUM on a NORMAL origin', () => {
  assert.equal(
    riskForOperation({ kind: 'browser.read', originClass: 'NORMAL', firstVisitToDomain: false })
      .risk,
    'LOW',
  );
  assert.equal(
    riskForOperation({ kind: 'browser.act', originClass: 'NORMAL', firstVisitToDomain: false })
      .risk,
    'MEDIUM',
  );
});

test('first navigation to an unseen domain is MEDIUM', () => {
  assert.equal(
    riskForOperation({ kind: 'browser.navigate', originClass: 'NORMAL', firstVisitToDomain: true })
      .risk,
    'MEDIUM',
  );
});
