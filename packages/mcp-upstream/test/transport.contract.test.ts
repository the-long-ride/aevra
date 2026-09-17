import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_DEADLINE_MS,
  type UpstreamTransport,
  type UpstreamTransportConfig,
} from '../src/transport.js';
import type { UpstreamServerInfo } from '../src/protocol.js';

test('a minimal object satisfying the four members is a valid transport', async () => {
  const info: UpstreamServerInfo = {
    name: 'fake',
    version: '1.0.0',
    protocolVersion: '2025-06-18',
    capabilities: {},
  };
  const transport: UpstreamTransport = {
    connect: async () => info,
    request: async (method) => method,
    close: async () => {},
    onNotification: () => {},
  };
  assert.deepEqual(await transport.connect(), info);
  assert.equal(await transport.request('tools/list'), 'tools/list');
});

test('the config union covers stdio, http and sse and is discriminated by transport', () => {
  const configs: UpstreamTransportConfig[] = [
    { transport: 'stdio', command: 'node', args: ['server.js'] },
    { transport: 'http', url: 'https://example.test/mcp' },
    { transport: 'sse', url: 'https://example.test/sse' },
  ];
  assert.deepEqual(
    configs.map((config) => (config.transport === 'stdio' ? config.command : config.url)),
    ['node', 'https://example.test/mcp', 'https://example.test/sse'],
  );
});

test('the default deadline is 30 seconds', () => {
  assert.equal(DEFAULT_DEADLINE_MS, 30_000);
});
