import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOperationEnvelope } from '../src/worker.js';
import { MCP_UPSTREAM_OPERATION_KINDS } from '../src/mcp-upstream.js';

const base = {
  version: 1,
  daemonInstanceId: 'd',
  operationId: 'o',
  sessionId: 's',
  workspaceId: 'w',
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 1000).toISOString(),
  nonce: 'n',
  executionMode: 'host',
  capabilityRoots: [],
  mac: 'm',
};

const samples: Record<string, unknown> = {
  'mcp.upstream.connect': {
    kind: 'mcp.upstream.connect',
    upstreamId: 'mu_1',
    config: {
      transport: 'http',
      url: 'https://a.test/mcp',
      headers: { Authorization: 'Bearer t' },
    },
  },
  'mcp.upstream.disconnect': { kind: 'mcp.upstream.disconnect', upstreamId: 'mu_1' },
  'mcp.upstream.status': { kind: 'mcp.upstream.status' },
  'mcp.upstream.catalog': { kind: 'mcp.upstream.catalog', upstreamId: 'mu_1' },
  'mcp.upstream.call': {
    kind: 'mcp.upstream.call',
    upstreamId: 'mu_1',
    call: { method: 'tool', name: 'echo', arguments: { text: 'hi' } },
  },
};

test('every upstream operation kind is namespaced and unique', () => {
  const kinds = [...MCP_UPSTREAM_OPERATION_KINDS];
  assert.equal(kinds.length, 5);
  assert.equal(new Set(kinds).size, kinds.length);
  for (const kind of kinds) assert.match(kind, /^mcp\.upstream\.[a-z]+$/);
});

test('the envelope accepts every upstream operation kind', () => {
  for (const kind of MCP_UPSTREAM_OPERATION_KINDS) {
    const operation = samples[kind];
    assert.ok(operation, `missing sample for ${kind}`);
    assert.equal(parseOperationEnvelope({ ...base, operation }).version, 1);
  }
});

test('the envelope rejects an upstream-looking kind that is not registered', () => {
  assert.throws(
    () => parseOperationEnvelope({ ...base, operation: { kind: 'mcp.upstream.sampling' } }),
    /Unknown operation kind/,
  );
});

test('only connect carries a credential; a call envelope carries none', () => {
  const call = JSON.stringify(samples['mcp.upstream.call']);
  assert.equal(call.includes('headers'), false);
  assert.equal(call.includes('"env"'), false);
  assert.equal(JSON.stringify(samples['mcp.upstream.catalog']).includes('headers'), false);
  assert.equal(JSON.stringify(samples['mcp.upstream.connect']).includes('headers'), true);
});
