import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertValidUpstreamName,
  parseStoredConfig,
  rowToRecord,
} from '../src/mcp-upstream/upstream-records.js';

test('a well-formed name is accepted', () => {
  for (const name of ['github', 'a', 'my-docs-2', '0abc', 'a'.repeat(32)])
    assertValidUpstreamName(name);
});

test('a malformed name is refused with a 400-shaped error', () => {
  for (const name of ['', 'GitHub', '-leading', 'has_underscore', 'a'.repeat(33), 'sp ace']) {
    assert.throws(
      () => assertValidUpstreamName(name),
      (error: Error & { code?: string; status?: number }) => {
        assert.equal(error.code, 'MCP_UPSTREAM_NAME_INVALID');
        assert.equal(error.status, 400);
        return true;
      },
    );
  }
});

test('a stdio config keeps its command, args and cwd', () => {
  assert.deepEqual(
    parseStoredConfig('stdio', { command: 'node', args: ['server.js'], cwd: '/srv' }),
    { command: 'node', args: ['server.js'], cwd: '/srv' },
  );
  assert.deepEqual(parseStoredConfig('stdio', { command: 'node' }), { command: 'node', args: [] });
});

test('a stdio config without a command is refused', () => {
  assert.throws(() => parseStoredConfig('stdio', { args: [] }), /needs a command/);
  assert.throws(() => parseStoredConfig('stdio', { command: '   ' }), /needs a command/);
  assert.throws(() => parseStoredConfig('stdio', { command: 'node', args: [7] }), /string args/);
});

test('an http or sse config must be an absolute http url', () => {
  assert.deepEqual(parseStoredConfig('http', { url: 'https://a.test/mcp' }), {
    url: 'https://a.test/mcp',
  });
  assert.deepEqual(parseStoredConfig('sse', { url: 'http://127.0.0.1:9000/sse' }), {
    url: 'http://127.0.0.1:9000/sse',
  });
  assert.throws(() => parseStoredConfig('http', { url: '/mcp' }), /absolute/);
  assert.throws(() => parseStoredConfig('http', { url: 'file:///etc/passwd' }), /http: or https:/);
  assert.throws(() => parseStoredConfig('http', {}), /needs a url/);
});

test('a row round-trips into a record with the right types', () => {
  const record = rowToRecord({
    id: 'mu_1',
    name: 'github',
    transport: 'http',
    configJson: '{"url":"https://a.test/mcp"}',
    authJson: '{"header":"Authorization","secretRefId":"sr_1"}',
    risk: 'HIGH',
    enabled: 1,
    catalogFingerprint: 'abc',
    state: 'active',
    createdAt: 't0',
    updatedAt: 't1',
  });
  assert.equal(record.enabled, true);
  assert.equal(record.catalogFingerprint, 'abc');
  assert.deepEqual(record.auth, { header: 'Authorization', secretRefId: 'sr_1' });
  assert.deepEqual(record.config, { url: 'https://a.test/mcp' });
});

test('a row with no fingerprint maps to null rather than the string null', () => {
  const record = rowToRecord({
    id: 'mu_1',
    name: 'github',
    transport: 'stdio',
    configJson: '{"command":"node","args":[]}',
    authJson: '{}',
    risk: 'LOW',
    enabled: 0,
    catalogFingerprint: null,
    state: 'needs-review',
    createdAt: 't0',
    updatedAt: 't1',
  });
  assert.equal(record.catalogFingerprint, null);
  assert.equal(record.enabled, false);
  assert.equal(record.state, 'needs-review');
});
