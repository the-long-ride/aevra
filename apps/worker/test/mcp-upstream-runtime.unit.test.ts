import assert from 'node:assert/strict';
import test from 'node:test';
import { UpstreamError } from '../../../packages/mcp-upstream/src/protocol.js';
import { UpstreamClient } from '../../../packages/mcp-upstream/src/client.js';
import { StdioTransport } from '../../../packages/mcp-upstream/src/stdio-transport.js';
import type { UpstreamTransportConfig } from '../../../packages/mcp-upstream/src/transport.js';
import { UpstreamSessionRegistry } from '../src/mcp-upstream-runtime.js';
import { FakeUpstreamClient, type FakeUpstreamOptions } from './fake-upstream-client.js';

const httpConfig: UpstreamTransportConfig = { transport: 'http', url: 'https://a.test/mcp' };

function harness(options: FakeUpstreamOptions = {}) {
  const clients: FakeUpstreamClient[] = [];
  let clock = 1_000_000;
  const registry = new UpstreamSessionRegistry({
    createClient: () => {
      const client = new FakeUpstreamClient(options);
      clients.push(client);
      return client;
    },
    now: () => clock,
  });
  return {
    registry,
    clients,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

test('connect opens a session and reports the upstream identity', async () => {
  const { registry, clients } = harness();
  const status = await registry.connect('mu_1', httpConfig);
  assert.equal(status.upstreamId, 'mu_1');
  assert.equal(status.state, 'connected');
  assert.equal(status.server?.name, 'fake-upstream');
  assert.equal(status.server?.version, '1.2.3');
  assert.equal(clients.length, 1);
});

test('a transport that closes during handshake is not published as connected', async () => {
  const { registry } = harness({ closeDuringConnect: true });
  await assert.rejects(
    registry.connect('mu_1', httpConfig),
    (error: UpstreamError) => error.code === 'UPSTREAM_DIED',
  );
  assert.equal(registry.status('mu_1')[0]?.state, 'idle');
});

test('a spontaneous transport close invalidates the connected session', async () => {
  const { registry, clients } = harness();
  await registry.connect('mu_1', httpConfig);
  clients[0]!.emitClosed();
  assert.equal(registry.status('mu_1')[0]?.state, 'idle');
  assert.equal(registry.status('mu_1')[0]?.server, null);
});

test('sessions are keyed by upstream id, not shared', async () => {
  const { registry, clients } = harness();
  await registry.connect('mu_1', httpConfig);
  await registry.connect('mu_2', { transport: 'sse', url: 'https://b.test/sse' });
  assert.equal(clients.length, 2);
  assert.deepEqual(
    registry.status().map((entry) => entry.upstreamId),
    ['mu_1', 'mu_2'],
  );
  assert.deepEqual(
    registry.status('mu_2').map((entry) => entry.upstreamId),
    ['mu_2'],
  );
});

test('a catalog and a call reuse the session opened by connect', async () => {
  const { registry, clients } = harness({
    catalog: { tools: [{ name: 'echo' }], resources: [], prompts: [] },
  });
  await registry.connect('mu_1', httpConfig);
  const catalog = await registry.catalog('mu_1');
  assert.deepEqual(
    catalog.tools.map((tool) => tool.name),
    ['echo'],
  );
  await registry.call('mu_1', { method: 'tool', name: 'echo', arguments: { text: 'hi' } });
  assert.equal(clients.length, 1);
  assert.equal(clients[0]!.connects, 1);
});

test('each call shape reaches its own client method', async () => {
  const seen: string[] = [];
  const { registry } = harness({
    onCall: (method) => {
      seen.push(method);
      return { ok: true };
    },
  });
  await registry.connect('mu_1', httpConfig);
  await registry.call('mu_1', { method: 'tool', name: 'echo', arguments: {} });
  await registry.call('mu_1', { method: 'resource', uri: 'file:///a.txt' });
  await registry.call('mu_1', { method: 'prompt', name: 'greet' });
  assert.deepEqual(seen, ['tools/call', 'resources/read', 'prompts/get']);
});

test('a call failure invalidates the session for core-managed recovery', async () => {
  let alive = true;
  const { registry, clients } = harness({
    onCall: () => {
      if (!alive) throw new UpstreamError('UPSTREAM_DIED', 'the upstream exited');
      return { ok: true };
    },
  });
  await registry.connect('mu_1', httpConfig);
  alive = false;
  await assert.rejects(registry.call('mu_1', { method: 'tool', name: 'echo', arguments: {} }));
  assert.equal(registry.status('mu_1')[0]?.state, 'idle');
  alive = true;
  assert.equal(clients.length, 1);
});

test('two concurrent calls on a cold session open exactly one connection', async () => {
  const { registry, clients } = harness();
  await registry.connect('mu_1', httpConfig);
  await registry.disconnect('mu_1');
  await registry.connect('mu_1', httpConfig);
  const both = await Promise.all([
    registry.call('mu_1', { method: 'tool', name: 'a', arguments: {} }),
    registry.call('mu_1', { method: 'tool', name: 'b', arguments: {} }),
  ]);
  assert.equal(both.length, 2);
  assert.equal(clients.filter((client) => client.connects > 0).length, 2);
});

test('a list_changed notification is recorded so core can invalidate its cache', async () => {
  const { registry, clients } = harness();
  await registry.connect('mu_1', httpConfig);
  assert.equal(registry.status('mu_1')[0]?.listChangedAt, null);
  clients[0]!.emit('notifications/tools/list_changed');
  assert.notEqual(registry.status('mu_1')[0]?.listChangedAt, null);
});

test('worker redacts exact configured credentials from nested upstream output', async () => {
  const secret = 'tiny';
  const { registry } = harness({
    onCall: () => ({
      content: [{ type: 'text', text: `value=${secret}` }],
      nested: { values: [secret] },
      [secret]: { [secret]: secret },
    }),
  });
  await registry.connect('mu_1', {
    ...httpConfig,
    headers: { Authorization: secret },
  });
  const result = JSON.stringify(
    await registry.call('mu_1', { method: 'tool', name: 'echo', arguments: {} }),
  );
  assert.equal(result.includes(secret), false);
  assert.match(result, /\[redacted\]/);
});

test('worker redacts configured credentials from upstream error details', async () => {
  const secret = 'tiny';
  const { registry } = harness({
    onCall: () => {
      throw new UpstreamError('UPSTREAM_CALL_FAILED', `failed=${secret}`, { token: secret });
    },
  });
  await registry.connect('mu_1', {
    ...httpConfig,
    headers: { Authorization: secret },
  });
  await assert.rejects(
    registry.call('mu_1', { method: 'tool', name: 'echo', arguments: {} }),
    (error: UpstreamError) => {
      assert.equal(error.message.includes(secret), false);
      assert.equal(JSON.stringify(error.details).includes(secret), false);
      return true;
    },
  );
});

test('a timed-out stdio session is reinitialized before recovery calls', async () => {
  const script = [
    "const readline=require('node:readline');",
    'let initialized=false;',
    "const send=(value)=>process.stdout.write(JSON.stringify(value)+'\\n');",
    "readline.createInterface({input:process.stdin}).on('line',line=>{",
    'const request=JSON.parse(line);',
    "if(request.method==='initialize'){initialized=true;send({jsonrpc:'2.0',id:request.id,result:{serverInfo:{name:'recovery',version:'1'},capabilities:{tools:{}}}});}",
    "else if(request.method==='notifications/initialized'){}",
    "else if(request.method==='tools/call' && request.params.name==='hang'){}",
    "else if(request.method==='tools/call')send({jsonrpc:'2.0',id:request.id,result:{initialized}});",
    '});',
  ].join('');
  let now = 1_000_000;
  const registry = new UpstreamSessionRegistry({
    createClient: (config) => {
      if (config.transport !== 'stdio') throw new Error('expected stdio transport');
      return new UpstreamClient(new StdioTransport({ ...config, deadlineMs: 500 }));
    },
    now: () => now,
  });
  const config = {
    transport: 'stdio' as const,
    command: process.execPath,
    args: ['-e', script],
  };
  try {
    await registry.connect('mu_timeout', config);
    await assert.rejects(
      registry.call('mu_timeout', { method: 'tool', name: 'hang', arguments: {} }),
      (error: UpstreamError) => error.code === 'UPSTREAM_TIMEOUT',
    );
    assert.equal(registry.status('mu_timeout')[0]?.state, 'idle');
    assert.equal(registry.status('mu_timeout')[0]?.failures, 1);
    now += 2_000;
    await registry.connect('mu_timeout', config);
    const result = await registry.call('mu_timeout', {
      method: 'tool',
      name: 'echo',
      arguments: {},
    });
    assert.deepEqual(result, { initialized: true });
  } finally {
    await registry.disconnect();
  }
});

test('calls never reconnect a dead session before core validates its catalog', async () => {
  const { registry, clients, advance } = harness();
  await registry.connect('mu_1', httpConfig);
  clients[0]!.emitClosed();
  advance(2_000);
  for (const call of [
    { method: 'tool' as const, name: 'echo', arguments: {} },
    { method: 'resource' as const, uri: 'file:///a' },
    { method: 'prompt' as const, name: 'greet' },
  ])
    await assert.rejects(
      registry.call('mu_1', call),
      (error: UpstreamError) => error.code === 'UPSTREAM_DIED',
    );
  assert.equal(clients.length, 1);
});

for (const mode of ['disconnect', 'shutdown', 'replace'] as const) {
  test(`${mode} retires a pending handshake`, async () => {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const first = new FakeUpstreamClient();
    const connect = first.connect.bind(first);
    first.connect = async () => {
      started();
      await gate;
      return connect();
    };
    let count = 0;
    const registry = new UpstreamSessionRegistry({
      createClient: () => (++count === 1 ? first : new FakeUpstreamClient()),
      now: () => 0,
    });
    const pending = registry.connect('mu_1', httpConfig);
    const rejected = assert.rejects(
      pending,
      (error: UpstreamError) => error.code === 'UPSTREAM_DIED',
    );
    await entered;
    if (mode === 'replace') await registry.connect('mu_1', httpConfig);
    else await registry.disconnect(mode === 'shutdown' ? undefined : 'mu_1');
    release();
    try {
      await rejected;
      assert.ok(first.closes >= 1);
      assert.equal(registry.status().length, mode === 'replace' ? 1 : 0);
    } finally {
      await registry.disconnect();
    }
  });
}

test('disconnect closes the client and forgets the session', async () => {
  const { registry, clients } = harness();
  await registry.connect('mu_1', httpConfig);
  await registry.disconnect('mu_1');
  assert.equal(clients[0]!.closes, 1);
  assert.deepEqual(registry.status(), []);
  await assert.rejects(registry.catalog('mu_1'), /No upstream session/);
});

test('disconnect with no id tears down every session', async () => {
  const { registry, clients } = harness();
  await registry.connect('mu_1', httpConfig);
  await registry.connect('mu_2', httpConfig);
  await registry.disconnect();
  assert.deepEqual(registry.status(), []);
  assert.deepEqual(
    clients.map((client) => client.closes),
    [1, 1],
  );
});
