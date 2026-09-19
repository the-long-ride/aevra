import assert from 'node:assert/strict';
import test from 'node:test';
import { ConnectionRateLimiter } from '../src/mcp/connection-rate-limit.js';

test('connection rate limiter allows burst up to capacity and refills over time', () => {
  let now = 1000000;
  const limiter = new ConnectionRateLimiter({
    capacity: 10,
    refillPerSecond: 2,
    now: () => now,
  });

  const connId = 'conn_test_rate';

  // Consume all 10 tokens
  for (let i = 0; i < 10; i++) {
    assert.equal(limiter.allow(connId), true, `Token ${i} should be allowed`);
  }

  // 11th request is throttled
  assert.equal(limiter.allow(connId), false);
  assert.equal(limiter.retryAfterSeconds(connId), 1);

  // Advance 1 second -> refills 2 tokens
  now += 1000;
  assert.equal(limiter.allow(connId), true);
  assert.equal(limiter.allow(connId), true);
  assert.equal(limiter.allow(connId), false);

  // Clear resets connection bucket
  limiter.clear(connId);
  assert.equal(limiter.allow(connId), true);
});

test('distinct connections have independent rate limit buckets', () => {
  let now = 1000000;
  const limiter = new ConnectionRateLimiter({
    capacity: 2,
    refillPerSecond: 1,
    now: () => now,
  });

  assert.equal(limiter.allow('conn_a'), true);
  assert.equal(limiter.allow('conn_a'), true);
  assert.equal(limiter.allow('conn_a'), false);

  // conn_b is unaffected
  assert.equal(limiter.allow('conn_b'), true);
  assert.equal(limiter.allow('conn_b'), true);
  assert.equal(limiter.allow('conn_b'), false);
});

test('idle buckets are pruned after idle timeout', () => {
  let now = 1000000;
  const limiter = new ConnectionRateLimiter({
    capacity: 5,
    refillPerSecond: 1,
    idlePruneMs: 60000, // 1 minute
    now: () => now,
  });

  limiter.allow('conn_old');
  assert.equal(limiter.size(), 1);

  // Advance past idle prune
  now += 70000;
  limiter.allow('conn_new');
  // conn_old should have been pruned
  assert.equal(limiter.size(), 1);
});

test('F5: at capacity, actively exhausted buckets are never evicted to reset limits', () => {
  let now = 1000000;
  const limiter = new ConnectionRateLimiter({
    capacity: 1,
    refillPerSecond: 0,
    maxKeys: 2,
    now: () => now,
  });

  assert.equal(limiter.allow('conn_1'), true);
  assert.equal(limiter.allow('conn_2'), true);

  // Both are now exhausted (tokens < 1)
  assert.equal(limiter.allow('conn_1'), false);
  assert.equal(limiter.allow('conn_2'), false);

  // A third connection arrives. Because both existing buckets have 0 tokens (< 1),
  // neither is evicted, and conn_3 is refused!
  assert.equal(limiter.allow('conn_3'), false);
  assert.equal(limiter.size(), 2);

  // Neither conn_1 nor conn_2 had their limits reset by the arrival of conn_3
  assert.equal(limiter.allow('conn_1'), false);
  assert.equal(limiter.allow('conn_2'), false);
});
