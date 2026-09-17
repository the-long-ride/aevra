import assert from 'node:assert/strict';
import test from 'node:test';
import { PendingCalls } from '../src/pending-calls.js';
import type { UpstreamError } from '../src/protocol.js';

test('ids increment so two in-flight calls never collide', async () => {
  const calls = new PendingCalls(1000, () => {});
  const first = calls.issue('tools/list');
  const second = calls.issue('tools/call');
  assert.notEqual(first.id, second.id);
  assert.equal(calls.size(), 2);
  calls.failAll('UPSTREAM_DIED', 'cleanup');
  await Promise.allSettled([first.promise, second.promise]);
});

test('a matching response resolves its own call and no other', async () => {
  const calls = new PendingCalls(1000, () => {});
  const first = calls.issue<{ ok: boolean }>('tools/list');
  const second = calls.issue('tools/call');
  calls.settle({ jsonrpc: '2.0', id: first.id, result: { ok: true } });
  assert.deepEqual(await first.promise, { ok: true });
  assert.equal(calls.size(), 1);
  calls.failAll('UPSTREAM_DIED', 'cleanup');
  await assert.rejects(second.promise);
});

test('a JSON-RPC error response rejects with UPSTREAM_CALL_FAILED', async () => {
  const calls = new PendingCalls(1000, () => {});
  const call = calls.issue('tools/call');
  calls.settle({
    jsonrpc: '2.0',
    id: call.id,
    error: { code: -32602, message: 'unknown tool', data: { tool: 'nope' } },
  });
  await assert.rejects(call.promise, (error: UpstreamError) => {
    assert.equal(error.code, 'UPSTREAM_CALL_FAILED');
    assert.equal(error.message, 'unknown tool');
    assert.deepEqual(error.details, { tool: 'nope' });
    return true;
  });
});

test('a call past its deadline rejects and runs the timeout hook once', async () => {
  let teardowns = 0;
  const calls = new PendingCalls(5, () => {
    teardowns += 1;
  });
  const call = calls.issue('tools/list');
  await assert.rejects(call.promise, (error: UpstreamError) => {
    assert.equal(error.code, 'UPSTREAM_TIMEOUT');
    assert.match(error.message, /tools\/list/);
    return true;
  });
  assert.equal(teardowns, 1);
  calls.failAll('UPSTREAM_DIED', 'gone');
  assert.equal(calls.size(), 0);
});

test('a response from a previous generation cannot resolve a later call', async () => {
  const calls = new PendingCalls(1000, () => {});
  const dead = calls.issue('tools/list');
  const beforeGeneration = calls.generation();
  calls.failAll('UPSTREAM_DIED', 'the upstream exited');
  await assert.rejects(dead.promise, (error: UpstreamError) => error.code === 'UPSTREAM_DIED');
  assert.notEqual(calls.generation(), beforeGeneration);

  const live = calls.issue<string>('tools/list');
  calls.settle({ jsonrpc: '2.0', id: dead.id, result: 'stale' });
  calls.settle({ jsonrpc: '2.0', id: live.id, result: 'fresh' });
  assert.equal(await live.promise, 'fresh');
});
