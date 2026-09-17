import assert from 'node:assert/strict';
import test from 'node:test';
import type { UpstreamTransportConfig } from '../../../packages/mcp-upstream/src/transport.js';
import {
  dispatchMcpUpstreamOperation,
  isMcpUpstreamOperation,
} from '../src/mcp-upstream-dispatch.js';
import { UpstreamSessionRegistry } from '../src/mcp-upstream-runtime.js';
import { FakeUpstreamClient } from './fake-upstream-client.js';

const config: UpstreamTransportConfig = { transport: 'http', url: 'https://a.test/mcp' };

function registry() {
  const seen: string[] = [];
  const sessions = new UpstreamSessionRegistry({
    createClient: () =>
      new FakeUpstreamClient({
        catalog: { tools: [{ name: 'echo' }], resources: [], prompts: [] },
        onCall: (method, payload) => {
          seen.push(method);
          return payload;
        },
      }),
    now: () => Date.now(),
  });
  return { sessions, seen };
}

test('the predicate accepts only the mcp.upstream family', () => {
  assert.equal(isMcpUpstreamOperation({ kind: 'mcp.upstream.status' }), true);
  assert.equal(isMcpUpstreamOperation({ kind: 'desktop.status' }), false);
  assert.equal(isMcpUpstreamOperation({ kind: 'file.list', path: '/' }), false);
});

test('connect, catalog, call, status and disconnect each reach the registry', async () => {
  const { sessions, seen } = registry();
  const connected = await dispatchMcpUpstreamOperation(
    { kind: 'mcp.upstream.connect', upstreamId: 'mu_1', config },
    sessions,
  );
  assert.equal((connected as { state: string }).state, 'connected');
  const catalog = await dispatchMcpUpstreamOperation(
    { kind: 'mcp.upstream.catalog', upstreamId: 'mu_1' },
    sessions,
  );
  assert.deepEqual(
    (catalog as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name),
    ['echo'],
  );
  await dispatchMcpUpstreamOperation(
    {
      kind: 'mcp.upstream.call',
      upstreamId: 'mu_1',
      call: { method: 'tool', name: 'echo', arguments: { text: 'hi' } },
    },
    sessions,
  );
  assert.deepEqual(seen, ['tools/call']);
  const status = await dispatchMcpUpstreamOperation({ kind: 'mcp.upstream.status' }, sessions);
  assert.deepEqual(
    (status as Array<{ upstreamId: string }>).map((entry) => entry.upstreamId),
    ['mu_1'],
  );
  await dispatchMcpUpstreamOperation(
    { kind: 'mcp.upstream.disconnect', upstreamId: 'mu_1' },
    sessions,
  );
  assert.deepEqual(
    await dispatchMcpUpstreamOperation({ kind: 'mcp.upstream.status' }, sessions),
    [],
  );
});

test('a call against an unknown upstream is refused rather than silently ignored', async () => {
  const { sessions } = registry();
  await assert.rejects(
    dispatchMcpUpstreamOperation(
      {
        kind: 'mcp.upstream.call',
        upstreamId: 'mu_missing',
        call: { method: 'tool', name: 'echo', arguments: {} },
      },
      sessions,
    ),
    /No upstream session is configured for mu_missing/,
  );
});
