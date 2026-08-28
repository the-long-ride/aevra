import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDashboardRuntimeSnapshot } from '../src/admin/dashboard-runtime.js';

const transport = {
  state: 'local-http' as const,
  summary: 'HTTP is limited to the loopback gateway; Admin and MCP remain HTTPS.',
  gateway: {
    url: 'http://127.0.0.1:47830',
    protocol: 'http' as const,
    encrypted: false,
    loopback: true,
  },
  admin: {
    url: 'https://localhost:47831',
    protocol: 'https' as const,
    encrypted: true,
    loopback: true,
  },
  mcp: {
    url: 'https://localhost:47832',
    protocol: 'https' as const,
    encrypted: true,
    loopback: true,
  },
  public: {
    url: 'https://aevra.example.com',
    protocol: 'https' as const,
    encrypted: true,
  },
  issues: [],
};

test('dashboard runtime exposes the cached transport validation snapshot unchanged', () => {
  const snapshot = buildDashboardRuntimeSnapshot(
    { transportValidation: () => transport },
    { core: 'running' },
    '2026-08-27T12:00:00.000Z',
    new Date('2026-08-27T12:01:00.000Z'),
  );

  assert.strictEqual(snapshot.transport, transport);
});
