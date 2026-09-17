import assert from 'node:assert/strict';
import test from 'node:test';
import { UpstreamError } from '../../../packages/mcp-upstream/src/protocol.js';
import type { UpstreamTransportConfig } from '../../../packages/mcp-upstream/src/transport.js';
import { UpstreamSessionRegistry } from '../src/mcp-upstream-runtime.js';
import { FakeUpstreamClient } from './fake-upstream-client.js';

const TOKEN = 'Bearer sk-live-4f2c9d81aa';

function harness(failure: () => Error | null) {
  const clients: FakeUpstreamClient[] = [];
  let clock = 1_000_000;
  const config: UpstreamTransportConfig = {
    transport: 'http',
    url: 'https://a.test/mcp',
    headers: { Authorization: TOKEN },
  };
  const registry = new UpstreamSessionRegistry({
    createClient: () => {
      const client = new FakeUpstreamClient({ failConnect: failure });
      clients.push(client);
      return client;
    },
    now: () => clock,
  });
  return {
    registry,
    config,
    clients,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

test('a call inside the backoff window fails immediately without touching the network', async () => {
  const { registry, config, clients } = harness(
    () => new UpstreamError('UPSTREAM_CONNECT_FAILED', 'connection refused'),
  );
  await assert.rejects(registry.connect('mu_1', config));
  const attemptsAfterConnect = clients.length;
  const started = Date.now();
  await assert.rejects(
    registry.call('mu_1', { method: 'tool', name: 'echo', arguments: {} }),
    (error: UpstreamError) => {
      assert.equal(error.code, 'UPSTREAM_CONNECT_FAILED');
      assert.match(error.message, /not being retried yet/);
      return true;
    },
  );
  assert.ok(Date.now() - started < 200, 'the refusal must be immediate');
  assert.equal(clients.length, attemptsAfterConnect, 'no new connection was attempted');
});

test('backoff is capped and the session is reported degraded after repeated failures', async () => {
  const { registry, config, advance } = harness(
    () => new UpstreamError('UPSTREAM_CONNECT_FAILED', 'connection refused'),
  );
  await assert.rejects(registry.connect('mu_1', config));
  assert.equal(registry.status('mu_1')[0]?.state, 'idle');
  for (let attempt = 0; attempt < 6; attempt += 1) {
    advance(120_000);
    await assert.rejects(registry.catalog('mu_1'));
  }
  const status = registry.status('mu_1')[0];
  assert.equal(status?.state, 'degraded');
  assert.equal(status?.failures, 7);
  const wait = Date.parse(status!.retryAfter!) - 1_720_000;
  assert.ok(wait <= 60_000, `backoff must stay capped, got ${wait}ms`);
});

test('a successful reconnect after the window clears the failure state', async () => {
  let broken = true;
  const { registry, config, advance } = harness(() =>
    broken ? new UpstreamError('UPSTREAM_CONNECT_FAILED', 'connection refused') : null,
  );
  await assert.rejects(registry.connect('mu_1', config));
  broken = false;
  advance(5_000);
  await registry.catalog('mu_1');
  const status = registry.status('mu_1')[0];
  assert.equal(status?.state, 'connected');
  assert.equal(status?.failures, 0);
  assert.equal(status?.retryAfter, null);
  assert.equal(status?.lastError, null);
});

test('a credential quoted back by the upstream never reaches a status field', async () => {
  const { registry, config } = harness(
    () =>
      new UpstreamError(
        'UPSTREAM_CONNECT_FAILED',
        `401 Unauthorized: rejected credential ${TOKEN}`,
      ),
  );
  await assert.rejects(registry.connect('mu_1', config));
  const status = registry.status('mu_1')[0];
  assert.equal(status?.lastError?.includes('sk-live-4f2c9d81aa'), false);
  assert.match(status!.lastError!, /\[redacted\]/);
  assert.equal(JSON.stringify(registry.status()).includes('sk-live-4f2c9d81aa'), false);
});

test('status carries no transport config, so no credential can ride it out', async () => {
  const { registry, config } = harness(() => null);
  await registry.connect('mu_1', config);
  const serialized = JSON.stringify(registry.status());
  assert.equal(serialized.includes('sk-live-4f2c9d81aa'), false);
  assert.equal(serialized.includes('Authorization'), false);
  assert.equal(serialized.includes('a.test'), false);
});
