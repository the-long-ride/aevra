import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRuntimeTransport } from '../src/exposure/transport-validation.js';

test('local HTTP gateway is valid without treating its local URL as public exposure', () => {
  const result = validateRuntimeTransport({
    provider: 'local',
    gatewayUrl: 'http://127.0.0.1:47830',
    adminUrl: 'https://localhost:47831',
    mcpUrl: 'https://localhost:47832',
    publicUrl: 'http://127.0.0.1:47830',
    restartRequired: false,
  } as any);

  assert.equal(result.state, 'local-http');
  assert.deepEqual(result.issues, []);
});

test('direct HTTPS allows a network-bound gateway', () => {
  const result = validateRuntimeTransport({
    provider: 'direct',
    gatewayUrl: 'https://0.0.0.0:47830',
    adminUrl: 'https://localhost:47831',
    mcpUrl: 'https://localhost:47832',
    publicUrl: 'https://aevra.example.com',
    restartRequired: false,
  } as any);

  assert.equal(result.state, 'secure');
  assert.deepEqual(result.issues, []);
});

test('saved transport change reports action required until restart', () => {
  const result = validateRuntimeTransport({
    provider: 'local',
    gatewayUrl: 'https://127.0.0.1:47830',
    adminUrl: 'https://localhost:47831',
    mcpUrl: 'https://localhost:47832',
    restartRequired: true,
  } as any);

  assert.equal(result.state, 'action-required');
  assert.match(result.summary, /restart/i);
});
