import assert from 'node:assert/strict';
import test from 'node:test';
import {
  UPSTREAM_NAME_PATTERN,
  UpstreamInputError,
  parseUpstreamInput,
  publicUpstream,
} from '../src/admin/routes/mcp-upstream-input.js';

const httpBody = {
  name: 'github',
  transport: 'http',
  config: { url: 'https://mcp.example.com/mcp' },
  auth: { header: 'Authorization', secretRefId: 'sr_github' },
  risk: 'HIGH',
};

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    name: 'github',
    transport: 'http',
    config: { url: 'https://mcp.example.com/mcp' },
    auth: { kind: 'header', header: 'Authorization', secretRefId: 'sr_github' },
    risk: 'HIGH',
    enabled: true,
    state: 'active',
    toolCount: 3,
    resourceCount: 1,
    promptCount: 0,
    catalogFingerprint: 'abc123',
    pendingCatalogDiff: null,
    advisory: [{ tool: 'create_issue', readOnlyHint: false, destructiveHint: true }],
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
    ...overrides,
  } as any;
}

test('the name pattern is the namespacing rule from the design', () => {
  assert.equal(UPSTREAM_NAME_PATTERN.test('github'), true);
  assert.equal(UPSTREAM_NAME_PATTERN.test('a-b-9'), true);
  assert.equal(UPSTREAM_NAME_PATTERN.test('-leading'), false);
  assert.equal(UPSTREAM_NAME_PATTERN.test('Upper'), false);
  assert.equal(UPSTREAM_NAME_PATTERN.test('a__b'), false);
  assert.equal(UPSTREAM_NAME_PATTERN.test('a'.repeat(33)), false);
});

test('a well-formed http registration parses into a create input', () => {
  const input = parseUpstreamInput({ ...httpBody });
  assert.equal(input.name, 'github');
  assert.equal(input.transport, 'http');
  assert.deepEqual(input.config, { url: 'https://mcp.example.com/mcp' });
  assert.deepEqual(input.auth, {
    kind: 'header',
    header: 'Authorization',
    secretRefId: 'sr_github',
  });
  assert.equal(input.risk, 'HIGH');
  assert.equal(input.enabled, true);
});

test('a well-formed stdio registration parses its command and env references', () => {
  const input = parseUpstreamInput({
    name: 'local-fs',
    transport: 'stdio',
    config: { command: 'node', args: ['server.js'], cwd: '/srv/mcp' },
    auth: { env: { GITHUB_TOKEN: 'sr_gh' } },
    risk: 'MEDIUM',
  });
  assert.deepEqual(input.config, { command: 'node', args: ['server.js'], cwd: '/srv/mcp' });
  assert.deepEqual(input.auth, { kind: 'env', env: { GITHUB_TOKEN: 'sr_gh' } });
});

test('invalid names, transports, risks, and configs are refused with stable codes', () => {
  assert.throws(
    () => parseUpstreamInput({ ...httpBody, name: 'My Server' }),
    (e: UpstreamInputError) => e.code === 'UPSTREAM_NAME_INVALID',
  );
  assert.throws(
    () => parseUpstreamInput({ ...httpBody, transport: 'carrier-pigeon' }),
    (e: UpstreamInputError) => e.code === 'UPSTREAM_TRANSPORT_INVALID',
  );
  assert.throws(
    () => parseUpstreamInput({ ...httpBody, risk: 'PROBABLY_FINE' }),
    (e: UpstreamInputError) => e.code === 'UPSTREAM_RISK_INVALID',
  );
  assert.throws(
    () => parseUpstreamInput({ ...httpBody, config: { url: 'ftp://example.com' } }),
    (e: UpstreamInputError) => e.code === 'UPSTREAM_CONFIG_INVALID',
  );
  assert.throws(
    () => parseUpstreamInput({ ...httpBody, transport: 'stdio', config: { args: ['x'] } }),
    (e: UpstreamInputError) => e.code === 'UPSTREAM_CONFIG_INVALID',
  );
});

test('raw credential values are refused and absent auth means none', () => {
  assert.throws(
    () =>
      parseUpstreamInput({
        ...httpBody,
        auth: { header: 'Authorization', value: 'Bearer ghp_live_token' },
      }),
    (e: UpstreamInputError) => e.code === 'UPSTREAM_SECRET_VALUE_REJECTED',
  );
  assert.throws(
    () =>
      parseUpstreamInput({
        ...httpBody,
        auth: { header: 'Authorization', secretRefId: 'ghp_live_token' },
      }),
    (e: UpstreamInputError) => e.code === 'UPSTREAM_SECRET_VALUE_REJECTED',
  );
  assert.deepEqual(parseUpstreamInput({ ...httpBody, auth: undefined }).auth, { kind: 'none' });
});

test('the operator tier is the only source of risk and projection is a whitelist', () => {
  const input = parseUpstreamInput({
    ...httpBody,
    risk: 'LOW',
    annotations: { destructiveHint: true },
    advisory: [{ tool: 'rm' }],
  });
  assert.equal(input.risk, 'LOW');
  assert.equal('annotations' in (input as any), false);
  const projected = publicUpstream(record({ authValue: 'ghp_live_token' }));
  const rendered = JSON.stringify(projected);
  assert.equal(rendered.includes('ghp_live_token'), false);
  assert.equal('authValue' in (projected as any), false);
  assert.deepEqual(projected.auth, {
    kind: 'header',
    header: 'Authorization',
    secretRefId: 'sr_github',
  });
  assert.equal(projected.toolCount, 3);
});

test('the projection keeps a pending catalog diff for review', () => {
  const projected = publicUpstream(
    record({
      state: 'needs-review',
      pendingCatalogDiff: { added: ['new'], removed: [], changed: ['old'] },
    }),
  );
  assert.deepEqual(projected.pendingCatalogDiff, { added: ['new'], removed: [], changed: ['old'] });
});

test('the projection derives catalog counts when the registry has no denormalized counters', () => {
  const projected = publicUpstream(
    record({
      toolCount: undefined,
      resourceCount: undefined,
      promptCount: undefined,
      catalog: {
        tools: [{ name: 'search' }, { name: 'write' }],
        resources: [{ uri: 'repo://readme' }],
        prompts: [{ name: 'triage' }],
      },
    }),
  );
  assert.equal(projected.toolCount, 2);
  assert.equal(projected.resourceCount, 1);
  assert.equal(projected.promptCount, 1);
});
