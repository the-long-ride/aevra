import assert from 'node:assert/strict';
import test from 'node:test';
import {
  UpstreamInputError,
  parseUpstreamInput,
  publicUpstream,
} from '../src/admin/routes/mcp-upstream-input.js';

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof UpstreamInputError);
    assert.equal(error.name, 'UpstreamInputError');
    return error.code;
  }
  return 'NO_ERROR';
}

const stdio = { name: 'local', transport: 'stdio', risk: 'LOW' };

test('missing name, transport and risk fields are refused', () => {
  assert.equal(
    code(() => parseUpstreamInput({})),
    'UPSTREAM_NAME_INVALID',
  );
  assert.equal(
    code(() => parseUpstreamInput({ name: 'x' })),
    'UPSTREAM_TRANSPORT_INVALID',
  );
  assert.equal(
    code(() => parseUpstreamInput({ name: 'x', transport: 'sse' })),
    'UPSTREAM_RISK_INVALID',
  );
});

test('a stdio server without config or args runs its command bare', () => {
  assert.equal(
    code(() => parseUpstreamInput({ ...stdio })),
    'UPSTREAM_CONFIG_INVALID',
  );
  const input = parseUpstreamInput({ ...stdio, config: { command: ' node ', args: 'x', cwd: '' } });
  assert.deepEqual(input.config, { command: 'node', args: [] });
});

test('stdio args are stringified', () => {
  const input = parseUpstreamInput({ ...stdio, config: { command: 'node', args: [1, true] } });
  assert.deepEqual(input.config, { command: 'node', args: ['1', 'true'] });
});

test('http and sse servers need a parseable URL', () => {
  const base = { name: 'remote', transport: 'sse', risk: 'MEDIUM' };
  assert.equal(
    code(() => parseUpstreamInput({ ...base })),
    'UPSTREAM_CONFIG_INVALID',
  );
  assert.equal(
    code(() => parseUpstreamInput({ ...base, config: { url: 'not a url' } })),
    'UPSTREAM_CONFIG_INVALID',
  );
  assert.deepEqual(parseUpstreamInput({ ...base, config: { url: 'http://h.test/sse' } }).config, {
    url: 'http://h.test/sse',
  });
});

test('stdio auth: empty env means none, bad names and raw values are refused', () => {
  const withConfig = { ...stdio, config: { command: 'node' } };
  assert.deepEqual(parseUpstreamInput({ ...withConfig, auth: {} }).auth, { kind: 'none' });
  assert.deepEqual(parseUpstreamInput({ ...withConfig, auth: null }).auth, { kind: 'none' });
  assert.equal(
    code(() => parseUpstreamInput({ ...withConfig, auth: { env: { '1BAD': 'sr_a' } } })),
    'UPSTREAM_CONFIG_INVALID',
  );
  assert.equal(
    code(() => parseUpstreamInput({ ...withConfig, auth: { env: { GOOD: 'plain words' } } })),
    'UPSTREAM_SECRET_VALUE_REJECTED',
  );
  assert.equal(
    code(() => parseUpstreamInput({ ...withConfig, auth: { token: 'fixture-phrase-alpha' } })),
    'UPSTREAM_SECRET_VALUE_REJECTED',
  );
  assert.equal(
    code(() => parseUpstreamInput({ ...withConfig, auth: { secret: 'fixture-phrase-beta' } })),
    'UPSTREAM_SECRET_VALUE_REJECTED',
  );
});

test('header auth: no header or reference means none, invalid header names are refused', () => {
  const http = {
    name: 'remote',
    transport: 'http',
    risk: 'HIGH',
    config: { url: 'https://h.test' },
  };
  assert.deepEqual(parseUpstreamInput({ ...http, auth: {} }).auth, { kind: 'none' });
  assert.equal(
    code(() => parseUpstreamInput({ ...http, auth: { secretRefId: 'sr_a' } })),
    'UPSTREAM_CONFIG_INVALID',
  );
  assert.equal(
    code(() =>
      parseUpstreamInput({ ...http, auth: { header: 'Bad Header', secretRefId: 'sr_a' } }),
    ),
    'UPSTREAM_CONFIG_INVALID',
  );
  assert.equal(
    code(() => parseUpstreamInput({ ...http, auth: { header: 'X-Key' } })),
    'UPSTREAM_SECRET_VALUE_REJECTED',
  );
});

test('enabled is true when omitted and only literal true otherwise', () => {
  const base = { ...stdio, config: { command: 'node' } };
  assert.equal(parseUpstreamInput({ ...base, enabled: false }).enabled, false);
  assert.equal(parseUpstreamInput({ ...base, enabled: 'yes' }).enabled, false);
  assert.equal(parseUpstreamInput({ ...base, enabled: true }).enabled, true);
});

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    name: 'remote',
    transport: 'http',
    config: { url: 'https://h.test' },
    auth: { kind: 'none' },
    risk: 'LOW',
    enabled: true,
    state: 'active',
    createdAt: 'c',
    updatedAt: 'u',
    ...overrides,
  } as any;
}

test('projection without any catalog reports zero counts and no advisory', () => {
  const projected = publicUpstream(record());
  assert.equal(projected.toolCount, 0);
  assert.equal(projected.resourceCount, 0);
  assert.equal(projected.promptCount, 0);
  assert.deepEqual(projected.advisory, []);
  assert.equal(projected.pendingCatalogDiff, null);
});

test('projection derives advisory hints from the pending catalog before the active one', () => {
  const projected = publicUpstream(
    record({
      catalog: { tools: [{ name: 'old' }], resources: [], prompts: [] },
      pendingCatalog: {
        tools: [
          { name: 'read', annotations: { readOnlyHint: true } },
          { name: 'wipe', annotations: { destructiveHint: true } },
          { name: 'plain', annotations: {} },
          { name: 'bare' },
        ],
        resources: [{ uri: 'a' }, { uri: 'b' }],
        prompts: [],
      },
    }),
  );
  assert.equal(projected.toolCount, 4);
  assert.equal(projected.resourceCount, 2);
  assert.deepEqual(projected.advisory, [
    { tool: 'read', readOnlyHint: true },
    { tool: 'wipe', destructiveHint: true },
    { tool: 'plain' },
  ]);
});
