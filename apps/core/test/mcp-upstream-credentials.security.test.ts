import assert from 'node:assert/strict';
import test from 'node:test';
import type { SecretStore } from '../../../packages/secrets/src/store.js';
import {
  redactSecrets,
  resolveUpstreamTransport,
} from '../src/mcp-upstream/credential-resolver.js';
import type { UpstreamRecord } from '../src/mcp-upstream/upstream-records.js';

const TOKEN = 'sk-live-4f2c9d81aa3e';
function vault(entries: Record<string, string>): SecretStore {
  return {
    set: async () => {},
    get: async (ref: string) => entries[ref] ?? null,
    delete: async () => {},
  };
}
function httpRecord(overrides: Partial<UpstreamRecord> = {}): UpstreamRecord {
  return {
    id: 'mu_1',
    name: 'github',
    transport: 'http',
    config: { url: 'https://a.test/mcp' },
    auth: { header: 'Authorization', secretRefId: 'sr_1' },
    risk: 'HIGH',
    enabled: true,
    catalogFingerprint: null,
    catalog: null,
    pendingCatalogDiff: null,
    state: 'active',
    createdAt: 't0',
    updatedAt: 't0',
    ...overrides,
  };
}

test('an http credential resolves into the configured header', async () => {
  const resolved = await resolveUpstreamTransport(httpRecord(), vault({ sr_1: TOKEN }));
  assert.deepEqual(resolved.config, {
    transport: 'http',
    url: 'https://a.test/mcp',
    headers: { Authorization: TOKEN },
  });
  assert.deepEqual(resolved.knownSecrets, [TOKEN]);
});
test('any header name works', async () => {
  const resolved = await resolveUpstreamTransport(
    httpRecord({ transport: 'sse', auth: { header: 'X-API-Key', secretRefId: 'sr_1' } }),
    vault({ sr_1: TOKEN }),
  );
  assert.equal(resolved.config.transport, 'sse');
  assert.deepEqual(resolved.config.transport === 'stdio' ? null : resolved.config.headers, {
    'X-API-Key': TOKEN,
  });
});
test('a stdio credential resolves into the child environment', async () => {
  const resolved = await resolveUpstreamTransport(
    httpRecord({
      transport: 'stdio',
      config: { command: 'node', args: ['server.js'], cwd: '/srv' },
      auth: { env: { GITHUB_TOKEN: 'sr_1' } },
    }),
    vault({ sr_1: TOKEN }),
  );
  assert.deepEqual(resolved.config, {
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
    cwd: '/srv',
    env: { GITHUB_TOKEN: TOKEN },
  });
  assert.deepEqual(resolved.knownSecrets, [TOKEN]);
});
test('an upstream with no credential resolves with no header or env', async () => {
  const resolved = await resolveUpstreamTransport(httpRecord({ auth: {} }), vault({}));
  assert.deepEqual(resolved.config, { transport: 'http', url: 'https://a.test/mcp' });
  assert.deepEqual(resolved.knownSecrets, []);
});
test('a missing secret names the reference, never a value', async () => {
  await assert.rejects(
    resolveUpstreamTransport(httpRecord(), vault({ sr_other: TOKEN })),
    (error: Error & { code?: string }) => {
      assert.equal(error.code, 'MCP_UPSTREAM_SECRET_MISSING');
      assert.match(error.message, /sr_1/);
      assert.equal(error.message.includes(TOKEN), false);
      return true;
    },
  );
});
test('a secret reference without a header name is refused', async () => {
  await assert.rejects(
    resolveUpstreamTransport(httpRecord({ auth: { secretRefId: 'sr_1' } }), vault({ sr_1: TOKEN })),
    /MCP_UPSTREAM_AUTH_INVALID/,
  );
});
test('the stored record never gains the resolved value', async () => {
  const record = httpRecord();
  await resolveUpstreamTransport(record, vault({ sr_1: TOKEN }));
  assert.equal(JSON.stringify(record).includes(TOKEN), false);
  assert.deepEqual(record.auth, { header: 'Authorization', secretRefId: 'sr_1' });
});
test('redactSecrets scrubs every occurrence and leaves short values alone', () => {
  assert.equal(
    redactSecrets(`401 for ${TOKEN}; retry with ${TOKEN}`, [TOKEN]),
    '401 for [redacted]; retry with [redacted]',
  );
  assert.equal(redactSecrets('the cat sat', ['cat']), 'the cat sat');
  assert.equal(redactSecrets('nothing to do', []), 'nothing to do');
});
