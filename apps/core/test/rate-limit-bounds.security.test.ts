import test from 'node:test';
import assert from 'node:assert/strict';
import { IpRateLimiter } from '../src/mcp/rate-limit.js';

test('bucket and failure maps stay bounded under key cycling', () => {
  const limiter = new IpRateLimiter(5, 1 / 60, () => 1_000, 16);
  for (let index = 0; index < 500; index++) {
    limiter.allow(`10.0.0.${index}`);
    limiter.recordFailure(`10.0.0.${index}`);
  }
  assert.ok(limiter.size() <= 16, `expected <= 16 buckets, saw ${limiter.size()}`);
  assert.ok(limiter.failures().length <= 16);
});

test('eviction is least-recently-used so an active key survives cycling', () => {
  let clock = 1_000;
  const limiter = new IpRateLimiter(5, 0, () => clock, 4);
  limiter.allow('active');
  for (let index = 0; index < 20; index++) {
    clock += 1;
    limiter.allow(`filler-${index}`);
    clock += 1;
    limiter.allow('active');
  }
  assert.equal(limiter.allow('active'), false, 'active bucket must persist and exhaust');
});
