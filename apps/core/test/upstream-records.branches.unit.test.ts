import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertValidUpstreamName,
  parseStoredConfig,
  rowToRecord,
} from '../src/mcp-upstream/upstream-records.js';

const invalid = (message: RegExp) => (e: any) =>
  e.code === 'MCP_UPSTREAM_CONFIG_INVALID' && e.status === 400 && message.test(e.message);

test('upstream names must match the pattern', () => {
  assert.doesNotThrow(() => assertValidUpstreamName('files-1'));
  for (const name of ['', 'Upper', '-lead', 'a'.repeat(33), 7]) {
    assert.throws(
      () => assertValidUpstreamName(name),
      (e: any) => e.code === 'MCP_UPSTREAM_NAME_INVALID',
    );
  }
});

test('stdio configs validate command, args, and cwd', () => {
  assert.throws(() => parseStoredConfig('stdio', null), invalid(/must be an object/));
  assert.throws(() => parseStoredConfig('stdio', []), invalid(/must be an object/));
  assert.throws(() => parseStoredConfig('stdio', { command: '  ' }), invalid(/needs a command/));
  assert.throws(
    () => parseStoredConfig('stdio', { command: 'node', args: 'x' }),
    invalid(/array of string args/),
  );
  assert.throws(
    () => parseStoredConfig('stdio', { command: 'node', args: [1] }),
    invalid(/array of string args/),
  );
  assert.throws(
    () => parseStoredConfig('stdio', { command: 'node', cwd: 5 }),
    invalid(/cwd must be a string/),
  );
  assert.deepEqual(parseStoredConfig('stdio', { command: 'node' }), { command: 'node', args: [] });
  assert.deepEqual(parseStoredConfig('stdio', { command: 'node', args: ['a'], cwd: '/w' }), {
    command: 'node',
    args: ['a'],
    cwd: '/w',
  });
});

test('url configs require absolute http(s) urls without userinfo', () => {
  assert.throws(() => parseStoredConfig('http', { url: '' }), invalid(/needs a url/));
  assert.throws(() => parseStoredConfig('sse', { url: 'relative/path' }), invalid(/absolute url/));
  assert.throws(
    () => parseStoredConfig('http', { url: 'ftp://host/x' }),
    invalid(/http: or https:/),
  );
  assert.throws(
    () => parseStoredConfig('http', { url: 'https://someone@host/x' }),
    invalid(/Credentials/),
  );
  assert.deepEqual(parseStoredConfig('http', { url: 'https://host.example/mcp' }), {
    url: 'https://host.example/mcp',
  });
});

test('rowToRecord parses JSON columns and defaults nullable fields', () => {
  const base = {
    id: 1,
    name: 'files',
    transport: 'stdio',
    configJson: '{"command":"node"}',
    risk: 'LOW',
    enabled: 1,
    state: 'active',
    createdAt: 'c',
    updatedAt: 'u',
  };
  const bare = rowToRecord(base);
  assert.equal(bare.id, '1');
  assert.deepEqual(bare.auth, {});
  assert.equal(bare.enabled, true);
  assert.equal(bare.catalogFingerprint, null);
  assert.equal(bare.catalog, null);
  assert.equal(bare.pendingCatalog, null);
  assert.equal(bare.pendingCatalogDiff, null);
  const full = rowToRecord({
    ...base,
    enabled: 0,
    authJson: '{"header":"x-name"}',
    catalogFingerprint: 42,
    catalogJson: '{"tools":[]}',
    pendingCatalogJson: '{"tools":[1]}',
    pendingCatalogDiffJson: '{"added":[]}',
  });
  assert.equal(full.enabled, false);
  assert.deepEqual(full.auth, { header: 'x-name' });
  assert.equal(full.catalogFingerprint, '42');
  assert.deepEqual(full.catalog, { tools: [] });
  assert.deepEqual(full.pendingCatalog, { tools: [1] });
  assert.deepEqual(full.pendingCatalogDiff, { added: [] });
  assert.equal(rowToRecord({ ...base, catalogFingerprint: null }).catalogFingerprint, null);
});
