import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MODERN_PROTOCOL_VERSION,
  decorateModernResult,
  modernDiscoverResult,
  validateModernRequest,
} from '../src/mcp/modern-protocol.js';

function request(headers: Record<string, string>) {
  return { headers } as any;
}

function body(method: string, params: Record<string, any> = {}) {
  return {
    jsonrpc: '2.0',
    id: 1,
    method,
    params: {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
        'io.modelcontextprotocol/clientInfo': { name: 'test-client', version: '1' },
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    },
  };
}

const publicBaseUrl = 'https://aevra.example.com';
const expectedIcon = [
  {
    src: `${publicBaseUrl}/aevra-logo.png`,
    mimeType: 'image/png',
  },
];

test('modern discovery advertises MCP 2026-07-28 with Aevra branding', () => {
  const result = modernDiscoverResult(publicBaseUrl);
  assert.deepEqual(result.supportedVersions, [MODERN_PROTOCOL_VERSION]);
  assert.equal(result.resultType, 'complete');
  assert.ok(result.capabilities.tools);
  assert.equal(result.cacheScope, 'public');
  assert.ok(result.ttlMs > 0);
  assert.equal(result._meta['io.modelcontextprotocol/serverInfo'].name, 'Aevra');
  assert.deepEqual(result._meta['io.modelcontextprotocol/serverInfo'].icons, expectedIcon);
});

test('modern request requires matching method and protocol headers', () => {
  const value = body('tools/list');
  assert.throws(
    () =>
      validateModernRequest(request({ 'mcp-protocol-version': MODERN_PROTOCOL_VERSION }), value),
    (error: any) => error?.code === -32020,
  );
  assert.doesNotThrow(() =>
    validateModernRequest(
      request({
        'mcp-protocol-version': MODERN_PROTOCOL_VERSION,
        'mcp-method': 'tools/list',
      }),
      value,
    ),
  );
});

test('modern named request requires matching Mcp-Name', () => {
  const value = body('tools/call', { name: 'file_list', arguments: {} });
  assert.throws(
    () =>
      validateModernRequest(
        request({
          'mcp-protocol-version': MODERN_PROTOCOL_VERSION,
          'mcp-method': 'tools/call',
          'mcp-name': 'wrong',
        }),
        value,
      ),
    (error: any) => error?.code === -32020,
  );
});

test('modern list results get deterministic order, cache hints and server info', () => {
  const response = decorateModernResult(
    { jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'z' }, { name: 'a' }] } },
    'tools/list',
    publicBaseUrl,
  );
  assert.deepEqual(
    response.result.tools.map((tool: any) => tool.name),
    ['a', 'z'],
  );
  assert.equal(response.result.cacheScope, 'private');
  assert.ok(response.result.ttlMs > 0);
  assert.equal(response.result._meta['io.modelcontextprotocol/serverInfo'].name, 'Aevra');
  assert.deepEqual(response.result._meta['io.modelcontextprotocol/serverInfo'].icons, expectedIcon);
});
