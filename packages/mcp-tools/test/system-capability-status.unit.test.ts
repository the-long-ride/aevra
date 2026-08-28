import assert from 'node:assert/strict';
import test from 'node:test';
import type { SystemCapabilitySnapshot } from '../../protocol/src/index.js';
import { handleBasicTool } from '../src/basic-tools.js';

const system: SystemCapabilitySnapshot = {
  scope: 'host',
  detectedAt: '2026-08-27T12:00:00.000Z',
  os: {
    platform: 'linux',
    platformDetail: 'Linux 6.8.0',
    arch: 'x64',
    recommendedShell: 'bash',
    availableShells: [{ id: 'bash', label: 'Bash', version: '5.2.0' }],
  },
  toolchains: [
    {
      id: 'git',
      label: 'Git',
      category: 'source-control',
      available: true,
      executable: 'git',
      version: '2.51.0',
    },
  ],
};

test('aevra_status exposes the cached system capability snapshot unchanged', async () => {
  const context: any = {
    sessions: {
      get: () => ({ id: 'session-1', actor: 'oauth:ChatGPT' }),
      leases: () => [],
      activeLease: () => null,
    },
    workspaces: { listRemote: () => [] },
    deps: { systemCapabilities: system },
  };

  const result: any = await handleBasicTool(context, 'session-1', 'aevra_status', {});

  assert.equal(result.execution.default, 'sandbox');
  assert.equal(result.execution.hostFallback, true);
  assert.equal(result.execution.system, system);
  assert.equal(result.execution.system.os.recommendedShell, 'bash');
  assert.equal((result.execution.system as any).scope, 'host');
});
