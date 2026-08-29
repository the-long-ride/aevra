import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { remoteIp } from '../src/mcp/http-response.js';
import { UNTRUSTED_FORWARDED_HEADERS } from '../src/gateway/public-gateway.js';

function request(headers: Record<string, string>): IncomingMessage {
  return { headers, socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage;
}

test('remoteIp ignores forwarded client IP headers by default', () => {
  assert.equal(remoteIp(request({ 'cf-connecting-ip': '9.9.9.9' })), '127.0.0.1');
  assert.equal(remoteIp(request({ 'true-client-ip': '9.9.9.9' })), '127.0.0.1');
  assert.equal(remoteIp(request({ 'x-real-ip': '9.9.9.9' })), '127.0.0.1');
});

test('remoteIp honors the forwarded client IP only when explicitly trusted', () => {
  assert.equal(remoteIp(request({ 'cf-connecting-ip': '9.9.9.9' }), true), '9.9.9.9');
});

test('the public gateway strips every client IP header before proxying', () => {
  for (const header of ['cf-connecting-ip', 'true-client-ip', 'x-real-ip']) {
    assert.equal(UNTRUSTED_FORWARDED_HEADERS.has(header), true, `${header} must be stripped`);
  }
});
