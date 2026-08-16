import assert from 'node:assert/strict'; import test from 'node:test';
import {IpRateLimiter} from '../src/mcp/rate-limit.js';
test('token bucket allows capacity then refills over time',()=>{
  let now=0;const limiter=new IpRateLimiter(3,1,()=>now);
  assert.equal(limiter.allow('1.2.3.4'),true);
  assert.equal(limiter.allow('1.2.3.4'),true);
  assert.equal(limiter.allow('1.2.3.4'),true);
  assert.equal(limiter.allow('1.2.3.4'),false); // exhausted
  now=2000; // 2s later: 2 tokens refilled
  assert.equal(limiter.allow('1.2.3.4'),true);
  assert.equal(limiter.allow('1.2.3.4'),true);
  assert.equal(limiter.allow('1.2.3.4'),false);
});
test('buckets are per ip and failures are counted and totaled',()=>{
  let now=0;const limiter=new IpRateLimiter(1,0.001,()=>now);
  assert.equal(limiter.allow('a'),true);assert.equal(limiter.allow('a'),false);
  assert.equal(limiter.allow('b'),true); // independent bucket
  limiter.recordFailure('a');limiter.recordFailure('a');
  assert.deepEqual(limiter.failures(),[{ip:'a',count:2}]);
  assert.equal(limiter.totalFailures(),2);
});
