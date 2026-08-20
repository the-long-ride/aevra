import assert from 'node:assert/strict';
import test from 'node:test';
import { redactText, sanitizeStructuredSecrets } from '../src/dlp.js';

test('DLP redacts known secrets and credential-like tokens', () => {
  const r = redactText('secret=alpha-secret ghp_abcdefghijklmnopqrstuvwxyz123456', [
    'alpha-secret',
  ]);
  assert.equal(r.text.includes('alpha-secret'), false);
  assert.equal(r.text.includes('ghp_'), false);
  assert.ok(r.redactionCount >= 2);
});

test('benign UUID and path survive entropy heuristic', () => {
  const v = '550e8400-e29b-41d4-a716-446655440000 /home/user/abcdefghijklmnopqrstuvwxyz123456';
  const r = redactText(v);
  assert.equal(r.text, v);
});

test('structured sanitizer treats __proto__ as inert data', () => {
  const source = JSON.parse(
    '{"__proto__":{"polluted":"yes"},"env":{"API_TOKEN":"synthetic-secret"}}',
  );
  const sanitized = sanitizeStructuredSecrets(source) as Record<string, unknown>;
  assert.equal(Object.getPrototypeOf(sanitized), null);
  assert.equal(Object.prototype.hasOwnProperty.call(sanitized, '__proto__'), true);
  assert.equal(({} as { polluted?: string }).polluted, undefined);
  assert.match(JSON.stringify(sanitized), /"__proto__"/);
  assert.equal(JSON.stringify(sanitized).includes('synthetic-secret'), false);
});
