import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { evaluateRuntimeCommand } from '../src/command-evaluation.js';

function runtimeContext(root: string, options: { denyNetwork?: boolean } = {}) {
  const lease = {
    workspaceId: 'ws-1',
    capabilities: ['commands.run', 'network'],
  };
  return {
    sessions: {
      get: () => ({ id: 's1', actor: 'operator' }),
      activeLease: () => lease,
      leaseForWorkspace: (_sessionId: string, workspaceId: string) =>
        workspaceId === lease.workspaceId ? lease : null,
      leases: () => [lease],
      isYolo: () => true,
    },
    workspaces: {
      getLocal: () => ({ id: 'ws-1', hostRoot: root }),
      capabilityRoots: () => [
        {
          id: 'root',
          logicalPrefix: '/',
          hostRoot: root,
          capabilities: ['commands.run'],
        },
      ],
    },
    deps: {
      settings: {
        get: () => ({ mode: 'unrestricted' }),
      },
      operations: {
        classifyNetwork: (destination: string) => ({
          known: false,
          family: `domain:${destination}`,
          destination,
        }),
      },
      permissions: {
        listRules: () => [],
        decide: (input: any) => {
          if (input.capability === 'network') {
            return options.denyNetwork
              ? { outcome: 'deny', reason: 'network denied now' }
              : { outcome: 'allow', reason: 'network allowed' };
          }
          return { outcome: 'approval', reason: 'no remembered command rule' };
        },
      },
    },
    oneTimeCapabilities: new Set<string>(),
  } as any;
}

test('evaluateRuntimeCommand shows in-scope YOLO overriding current network DENY', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aevra-command-eval-network-'));
  try {
    const result = await evaluateRuntimeCommand(
      runtimeContext(root, { denyNetwork: true }),
      's1',
      'ws-1',
      {
        kind: 'argv',
        executable: 'git',
        argv: ['git', 'push'],
        cwdLogical: '/',
        executionMode: 'host',
        networkDestinations: ['example.com'],
      },
    );

    assert.equal(result.decision.outcome, 'allow');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('evaluateRuntimeCommand carries classified CRITICAL risk into analysis and decision', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aevra-command-eval-critical-'));
  try {
    const result = await evaluateRuntimeCommand(runtimeContext(root), 's1', 'ws-1', {
      kind: 'argv',
      executable: 'bash',
      argv: ['bash', '-lc', 'sudo rm -rf /tmp/example'],
      cwdLogical: '/',
      executionMode: 'host',
      networkDestinations: [],
    });

    assert.ok(result.analysis.nodes.length > 0);
    assert.ok(result.analysis.nodes.every((node) => node.risk === 'CRITICAL'));
    assert.equal(result.decision.outcome, 'approval');
    assert.ok(result.decision.reasons.some((reason) => reason.code === 'CRITICAL_OPERATION'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
