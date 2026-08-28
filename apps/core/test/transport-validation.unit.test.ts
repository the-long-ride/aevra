import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRuntimeTransport } from '../src/exposure/transport-validation.js';

const secureLocal = {
  gatewayUrl: 'https://127.0.0.1:47830',
  adminUrl: 'https://localhost:47831',
  mcpUrl: 'https://localhost:47832',
};

test('accepts secure loopback transport without public exposure', () => {
  const result = validateRuntimeTransport(secureLocal);

  assert.equal(result.state, 'secure');
  assert.equal(result.gateway.encrypted, true);
  assert.equal(result.admin.encrypted, true);
  assert.equal(result.mcp.encrypted, true);
  assert.deepEqual(result.public, { protocol: null, encrypted: null });
  assert.deepEqual(result.issues, []);
});

test('accepts HTTP only on the loopback gateway', () => {
  const result = validateRuntimeTransport({
    ...secureLocal,
    gatewayUrl: 'http://127.0.0.1:47830',
    publicUrl: 'https://aevra.example.com',
  });

  assert.equal(result.state, 'local-http');
  assert.equal(result.gateway.protocol, 'http');
  assert.equal(result.gateway.encrypted, false);
  assert.equal(result.admin.protocol, 'https');
  assert.equal(result.mcp.protocol, 'https');
  assert.equal(result.public.protocol, 'https');
  assert.deepEqual(result.issues, []);
});

test('rejects non-loopback local service bindings', () => {
  const result = validateRuntimeTransport({
    gatewayUrl: 'http://192.168.1.10:47830',
    adminUrl: 'https://192.168.1.10:47831',
    mcpUrl: 'https://192.168.1.10:47832',
  });

  assert.equal(result.state, 'invalid');
  assert.deepEqual(result.issues, [
    'Local gateway must remain bound to loopback.',
    'Admin must remain bound to loopback.',
    'MCP ingress must remain bound to loopback.',
  ]);
});

test('rejects plaintext Admin MCP and public exposure', () => {
  const result = validateRuntimeTransport({
    gatewayUrl: 'http://localhost:47830',
    adminUrl: 'http://localhost:47831',
    mcpUrl: 'http://localhost:47832',
    publicUrl: 'http://aevra.example.com',
  });

  assert.equal(result.state, 'invalid');
  assert.equal(result.public.encrypted, false);
  assert.equal(result.public.protocol, null);
  assert.deepEqual(result.issues, [
    'Admin must use HTTPS.',
    'MCP ingress must use HTTPS.',
    'Public exposure must use HTTPS.',
  ]);
  assert.match(result.summary, /Admin must use HTTPS/);
});

test('recognizes IPv6 loopback', () => {
  const result = validateRuntimeTransport({
    gatewayUrl: 'http://[::1]:47830',
    adminUrl: 'https://[::1]:47831',
    mcpUrl: 'https://[::1]:47832',
  });

  assert.equal(result.state, 'local-http');
  assert.equal(result.gateway.loopback, true);
  assert.equal(result.admin.loopback, true);
  assert.equal(result.mcp.loopback, true);
});
