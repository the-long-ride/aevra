import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDashboardRuntimeSnapshot } from '../src/admin/dashboard-runtime.js';
import type { SystemCapabilitySnapshot } from '../../../packages/protocol/src/index.js';

const system: SystemCapabilitySnapshot = {
  scope: 'host',
  detectedAt: '2026-08-27T12:00:00.000Z',
  os: {
    platform: 'windows',
    platformDetail: 'Windows 11',
    arch: 'x64',
    recommendedShell: 'pwsh',
    availableShells: [{ id: 'pwsh', label: 'PowerShell 7', version: '7.5.2' }],
  },
  toolchains: [
    {
      id: 'node',
      label: 'Node.js',
      category: 'javascript',
      available: true,
      executable: 'node',
      version: '24.7.0',
    },
  ],
};

test('dashboard runtime exposes the cached system capability snapshot unchanged', () => {
  const snapshot = buildDashboardRuntimeSnapshot(
    { systemCapabilities: () => system },
    { core: 'running' },
    '2026-08-27T11:00:00.000Z',
    new Date('2026-08-27T12:00:00.000Z'),
  );

  assert.equal(snapshot.system, system);
  assert.equal(snapshot.system.os.recommendedShell, 'pwsh');
  assert.equal(snapshot.system.toolchains[0]?.version, '24.7.0');
});
