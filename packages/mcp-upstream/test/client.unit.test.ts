import assert from 'node:assert/strict';
import test from 'node:test';
import { UpstreamClient } from '../src/client.js';
import { UpstreamError, type UpstreamServerInfo } from '../src/protocol.js';
import type { UpstreamTransport } from '../src/transport.js';

function fakeTransport(
  capabilities: Record<string, unknown>,
  answers: Record<string, unknown>,
): UpstreamTransport & { calls: Array<{ method: string; params?: unknown }> } {
  const calls: Array<{ method: string; params?: unknown }> = [];
  const info: UpstreamServerInfo = {
    name: 'fake',
    version: '1.0.0',
    protocolVersion: '2025-06-18',
    capabilities,
  };
  return {
    calls,
    connect: async () => info,
    request: async (method, params) => {
      calls.push({ method, params });
      if (!(method in answers))
        throw new UpstreamError('UPSTREAM_CALL_FAILED', `no method ${method}`);
      return answers[method];
    },
    close: async () => {},
    onNotification: () => {},
  };
}

test('catalog fetches only the lists the server declares', async () => {
  const transport = fakeTransport({ tools: {} }, { 'tools/list': { tools: [{ name: 'echo' }] } });
  const client = new UpstreamClient(transport);
  await client.connect();
  const catalog = await client.catalog();
  assert.deepEqual(
    catalog.tools.map((tool) => tool.name),
    ['echo'],
  );
  assert.deepEqual(catalog.resources, []);
  assert.deepEqual(catalog.prompts, []);
  assert.deepEqual(
    transport.calls.map((call) => call.method),
    ['tools/list'],
  );
});

test('catalog collects tools, resources and prompts when all are declared', async () => {
  const transport = fakeTransport(
    { tools: {}, resources: {}, prompts: {} },
    {
      'tools/list': { tools: [{ name: 'echo', description: 'Echoes' }] },
      'resources/list': { resources: [{ uri: 'file:///a.txt', name: 'a' }] },
      'prompts/list': { prompts: [{ name: 'greet' }] },
    },
  );
  const client = new UpstreamClient(transport);
  await client.connect();
  const catalog = await client.catalog();
  assert.deepEqual(
    catalog.tools.map((tool) => tool.name),
    ['echo'],
  );
  assert.deepEqual(
    catalog.resources.map((resource) => resource.uri),
    ['file:///a.txt'],
  );
  assert.deepEqual(
    catalog.prompts.map((prompt) => prompt.name),
    ['greet'],
  );
});

test('one failing list does not empty the whole catalog', async () => {
  const transport = fakeTransport(
    { tools: {}, prompts: {} },
    { 'tools/list': { tools: [{ name: 'echo' }] } },
  );
  const client = new UpstreamClient(transport);
  await client.connect();
  const catalog = await client.catalog();
  assert.deepEqual(
    catalog.tools.map((tool) => tool.name),
    ['echo'],
  );
  assert.deepEqual(catalog.prompts, []);
});

test('a malformed list result yields an empty array rather than a crash', async () => {
  const transport = fakeTransport({ tools: {} }, { 'tools/list': { tools: 'not-an-array' } });
  const client = new UpstreamClient(transport);
  await client.connect();
  assert.deepEqual((await client.catalog()).tools, []);
});

test('catalog follows cursors for every declared list', async () => {
  const transport = fakeTransport(
    { tools: {}, resources: {}, prompts: {} },
    {
      'tools/list': { tools: [{ name: 'first' }], nextCursor: 'tools-2' },
      'resources/list': { resources: [{ uri: 'repo://first' }], nextCursor: 'resources-2' },
      'prompts/list': { prompts: [{ name: 'first-prompt' }], nextCursor: 'prompts-2' },
    },
  );
  const answers = new Map([
    ['tools-2', { tools: [{ name: 'second' }] }],
    ['resources-2', { resources: [{ uri: 'repo://second' }] }],
    ['prompts-2', { prompts: [{ name: 'second-prompt' }] }],
  ]);
  transport.request = async (method, params) => {
    transport.calls.push({ method, params });
    if (params && typeof params === 'object' && 'cursor' in params)
      return answers.get(String((params as { cursor: unknown }).cursor));
    return {
      'tools/list': { tools: [{ name: 'first' }], nextCursor: 'tools-2' },
      'resources/list': { resources: [{ uri: 'repo://first' }], nextCursor: 'resources-2' },
      'prompts/list': { prompts: [{ name: 'first-prompt' }], nextCursor: 'prompts-2' },
    }[method];
  };
  const client = new UpstreamClient(transport);
  await client.connect();
  const catalog = await client.catalog();
  assert.deepEqual(catalog.tools.map((tool) => tool.name), ['first', 'second']);
  assert.deepEqual(catalog.resources.map((resource) => resource.uri), ['repo://first', 'repo://second']);
  assert.deepEqual(catalog.prompts.map((prompt) => prompt.name), ['first-prompt', 'second-prompt']);
  assert.deepEqual(
    transport.calls.filter((call) => call.method === 'tools/list'),
    [
      { method: 'tools/list', params: undefined },
      { method: 'tools/list', params: { cursor: 'tools-2' } },
    ],
  );
});

test('a repeated cursor discards the partial list', async () => {
  const transport = fakeTransport(
    { tools: {} },
    { 'tools/list': { tools: [{ name: 'first' }], nextCursor: 'same' } },
  );
  transport.request = async (method, params) => {
    transport.calls.push({ method, params });
    return { tools: [{ name: params ? 'second' : 'first' }], nextCursor: 'same' };
  };
  const client = new UpstreamClient(transport);
  await client.connect();
  assert.deepEqual((await client.catalog()).tools, []);
});

test('a later page failure does not publish a partial catalog', async () => {
  const transport = fakeTransport(
    { tools: {} },
    { 'tools/list': { tools: [{ name: 'first' }], nextCursor: 'page-2' } },
  );
  transport.request = async (method, params) => {
    transport.calls.push({ method, params });
    if (params) throw new UpstreamError('UPSTREAM_CALL_FAILED', 'page unavailable');
    return { tools: [{ name: 'first' }], nextCursor: 'page-2' };
  };
  const client = new UpstreamClient(transport);
  await client.connect();
  await assert.rejects(client.catalog(), (error: UpstreamError) => {
    assert.equal(error.code, 'UPSTREAM_PROTOCOL');
    assert.match(error.message, /pagination was incomplete/);
    return true;
  });
});

test('callTool, readResource and getPrompt send the MCP method and params', async () => {
  const transport = fakeTransport(
    { tools: {}, resources: {}, prompts: {} },
    {
      'tools/call': { content: [{ type: 'text', text: 'hi' }] },
      'resources/read': { contents: [] },
      'prompts/get': { messages: [] },
    },
  );
  const client = new UpstreamClient(transport);
  await client.connect();
  await client.callTool('echo', { text: 'hi' });
  await client.readResource('file:///a.txt');
  await client.getPrompt('greet', { who: 'world' });
  assert.deepEqual(transport.calls, [
    { method: 'tools/call', params: { name: 'echo', arguments: { text: 'hi' } } },
    { method: 'resources/read', params: { uri: 'file:///a.txt' } },
    { method: 'prompts/get', params: { name: 'greet', arguments: { who: 'world' } } },
  ]);
});

test('catalog before connect is refused rather than silently empty', async () => {
  const client = new UpstreamClient(fakeTransport({ tools: {} }, {}));
  await assert.rejects(
    client.catalog(),
    (error: UpstreamError) => error.code === 'UPSTREAM_PROTOCOL',
  );
});
