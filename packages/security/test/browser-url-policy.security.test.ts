import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { scanNavigateUrl } from '../src/browser-url-policy.js';

test('an ordinary url passes', () => {
  const result = scanNavigateUrl('https://example.com/docs/getting-started?page=2');
  assert.equal(result.blocked, false);
});

test('a query parameter carrying an opaque high-entropy payload is blocked', () => {
  const payload = randomBytes(32).toString('base64url');
  const result = scanNavigateUrl(`https://collector.example/report?d=${payload}`);
  assert.equal(result.blocked, true);
  assert.equal(result.parameter, 'd');
});

test('a fragment carrying an opaque high-entropy payload is blocked', () => {
  const payload = randomBytes(32).toString('base64url');
  const result = scanNavigateUrl(`https://collector.example/#${payload}`);
  assert.equal(result.blocked, true);
});

test('a path segment carrying an opaque high-entropy payload is blocked', () => {
  const payload = randomBytes(32).toString('base64url');
  const result = scanNavigateUrl(`https://collector.example/exfil/${payload}`);
  assert.equal(result.blocked, true);
  assert.match(result.reason ?? '', /path/i);
});

/**
 * Percent-encodes every character, including the alphanumerics
 * `encodeURIComponent` leaves alone - the point here is that nothing
 * payload-shaped is visible in the raw URL at all.
 */
function percentEncodeAll(value: string): string {
  return [...value].map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('');
}

test('a percent-encoded payload in the path is decoded before it is judged', () => {
  // base64url, not base64: a plain base64 draw carries '/' about half the time,
  // which splits the decoded payload into short segments the blob heuristic is
  // right to ignore - a flake, not a finding.
  const payload = percentEncodeAll(randomBytes(32).toString('base64url'));
  const result = scanNavigateUrl(`https://collector.example/exfil/${payload}`);
  assert.equal(result.blocked, true);
});

test('a long readable path is not mistaken for a payload', () => {
  const result = scanNavigateUrl(
    'https://example.com/docs/getting-started/installation/windows/index.html',
  );
  assert.equal(result.blocked, false);
});

test('a uuid path segment is not mistaken for a payload', () => {
  const result = scanNavigateUrl(
    'https://example.com/orders/3f2504e0-4f89-11d3-9a0c-0305e82c3301/items',
  );
  assert.equal(result.blocked, false);
});

test('an unparseable url is blocked rather than passed through', () => {
  assert.equal(scanNavigateUrl('http://').blocked, true);
});
