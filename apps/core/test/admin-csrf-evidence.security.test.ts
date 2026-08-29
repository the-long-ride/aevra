import assert from 'node:assert/strict';
import test from 'node:test';
import type { IncomingMessage } from 'node:http';
import { sameOrigin } from '../src/admin/server.js';

const URL_ORIGIN = new URL('https://localhost:47831/api/settings');

function req(options: {
  method?: string;
  headers?: Record<string, string>;
  remoteAddress?: string;
}): IncomingMessage {
  return {
    method: options.method ?? 'POST',
    headers: options.headers ?? {},
    socket: { remoteAddress: options.remoteAddress ?? '203.0.113.5' },
  } as unknown as IncomingMessage;
}

test('a mutation with no Origin and no Sec-Fetch-Site is refused from a remote peer', () => {
  assert.equal(sameOrigin(req({}), URL_ORIGIN), false);
});

test('the loopback CLI, which sends neither header, is still allowed', () => {
  assert.equal(sameOrigin(req({ remoteAddress: '127.0.0.1' }), URL_ORIGIN), true);
  assert.equal(sameOrigin(req({ remoteAddress: '::1' }), URL_ORIGIN), true);
});

test('Sec-Fetch-Site same-origin or none is accepted', () => {
  assert.equal(sameOrigin(req({ headers: { 'sec-fetch-site': 'same-origin' } }), URL_ORIGIN), true);
  assert.equal(sameOrigin(req({ headers: { 'sec-fetch-site': 'none' } }), URL_ORIGIN), true);
});

test('a cross-site Sec-Fetch-Site is refused even from loopback', () => {
  assert.equal(
    sameOrigin(
      req({ headers: { 'sec-fetch-site': 'cross-site' }, remoteAddress: '127.0.0.1' }),
      URL_ORIGIN,
    ),
    false,
  );
});

test('a matching Origin is accepted and a foreign Origin is refused', () => {
  assert.equal(
    sameOrigin(req({ headers: { origin: 'https://localhost:47831' } }), URL_ORIGIN),
    true,
  );
  assert.equal(sameOrigin(req({ headers: { origin: 'https://evil.test' } }), URL_ORIGIN), false);
});

test('a trusted origin is accepted', () => {
  assert.equal(
    sameOrigin(req({ headers: { origin: 'https://admin.example' } }), URL_ORIGIN, [
      'https://admin.example',
    ]),
    true,
  );
});

test('reads are never blocked', () => {
  assert.equal(sameOrigin(req({ method: 'GET' }), URL_ORIGIN), true);
  assert.equal(sameOrigin(req({ method: 'HEAD' }), URL_ORIGIN), true);
});
