import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MODERN_PROTOCOL_VERSION,
  ModernProtocolError,
  decorateModernResult,
  isModernRequest,
  validateModernRequest,
} from '../src/mcp/modern-protocol.js';

const V = MODERN_PROTOCOL_VERSION;

function req(headers: Record<string, unknown>) {
  return { headers } as any;
}

function body(method: string, params: Record<string, unknown> = {}) {
  return { method, params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': V } } };
}

function failure(fn: () => void) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ModernProtocolError);
    return error;
  }
  assert.fail('expected ModernProtocolError');
}

test('non-string header values are ignored when detecting modern requests', () => {
  assert.equal(isModernRequest(req({ 'mcp-protocol-version': [V] }), {}), false);
  assert.equal(isModernRequest(req({}), { params: { _meta: { 'io.modelcontextprotocol/protocolVersion': 7 } } }), false);
  assert.equal(isModernRequest(req({}), { method: 'server/discover' }), true);
  assert.equal(isModernRequest(req({}), undefined), false);
});

test('discover with a different protocol version reports unsupported version', () => {
  const error = failure(() =>
    validateModernRequest(req({ 'mcp-protocol-version': '2020-01-01' }), { method: 'server/discover' }),
  );
  assert.equal(error.code, -32022);
  assert.equal(error.name, 'UnsupportedProtocolVersion');
  assert.deepEqual(error.data, { supported: [V], requested: '2020-01-01' });
  const missing = failure(() => validateModernRequest(req({}), { method: 'server/discover' }));
  assert.equal(missing.code, -32020);
  assert.equal(missing.name, 'HeaderMismatch');
  const noMethod = failure(() => validateModernRequest(req({ 'mcp-protocol-version': V }), body('tools/list')));
  assert.match(noMethod.message, /Mcp-Method header does not match/);
  const noMeta = failure(() => validateModernRequest(req({ 'mcp-protocol-version': V, 'mcp-method': 'tools/list' }), { method: 'tools/list' }));
  assert.match(noMeta.message, /does not match request _meta/);
});

test('resources/read compares Mcp-Name against the uri, including base64 values', () => {
  const readBody = body('resources/read', { uri: 'aevra://skill/user/a b' });
  const headers = { 'mcp-protocol-version': V, 'mcp-method': 'resources/read' };
  validateModernRequest(req({ ...headers, 'mcp-name': 'aevra://skill/user/a b' }), readBody);
  const encoded = Buffer.from('aevra://skill/user/a b').toString('base64');
  validateModernRequest(req({ ...headers, 'mcp-name': `=?base64?${encoded}?=` }), readBody);
  assert.match(
    failure(() => validateModernRequest(req({ ...headers, 'mcp-name': 'other' }), readBody)).message,
    /Mcp-Name header does not match/,
  );
  assert.match(
    failure(() => validateModernRequest(req(headers), body('resources/read', { uri: 5 }))).message,
    /Mcp-Name/,
  );
});

test('malformed base64 header values are rejected', () => {
  const headers = { 'mcp-protocol-version': V, 'mcp-method': 'tools/call' };
  const callBody = body('tools/call', { name: 'x' });
  for (const value of ['=?base64??=', '=?base64?abc?=', '=?base64?ab$=?=', '=?base64?QQ=x?=', '=?base64?QR==?=']) {
    const error = failure(() => validateModernRequest(req({ ...headers, 'mcp-name': value }), callBody));
    assert.equal(error.message, 'Invalid base64-encoded MCP header value', value);
  }
  // A value that only looks like the prefix is compared verbatim.
  validateModernRequest(req({ ...headers, 'mcp-name': '=?base64?x' }), body('tools/call', { name: '=?base64?x' }));
});

test('decorateModernResult leaves errors and empty results untouched', () => {
  const error = { error: { code: 1 }, result: { a: 1 } };
  assert.equal(decorateModernResult(error, 'tools/list'), error);
  const empty = { id: 1 };
  assert.equal(decorateModernResult(empty), empty);
  assert.equal(decorateModernResult(undefined), undefined);
});

test('decorateModernResult keeps caller-supplied cache hints and meta', () => {
  const decorated = decorateModernResult(
    { result: { resultType: 'partial', ttlMs: 5, cacheScope: 'public', _meta: { keep: true }, tools: 'n/a' } },
    'tools/list',
    'https://example.test',
  );
  assert.equal(decorated.result.resultType, 'partial');
  assert.equal(decorated.result.ttlMs, 5);
  assert.equal(decorated.result.cacheScope, 'public');
  assert.equal(decorated.result.tools, 'n/a');
  assert.equal(decorated.result._meta.keep, true);
  assert.ok(decorated.result._meta['io.modelcontextprotocol/serverInfo']);
  const uncached = decorateModernResult({ result: {} }, 'tools/call');
  assert.equal(uncached.result.ttlMs, undefined);
  assert.equal(decorateModernResult({ result: {} }).result.resultType, 'complete');
});

test('tools/list sorting treats missing names as empty strings', () => {
  const decorated = decorateModernResult(
    { result: { tools: [{ name: 'b' }, {}, null, { name: 'a' }, { name: 'a' }] } },
    'tools/list',
  );
  assert.deepEqual(
    decorated.result.tools.map((tool: any) => tool?.name),
    [undefined, undefined, 'a', 'a', 'b'],
  );
});
