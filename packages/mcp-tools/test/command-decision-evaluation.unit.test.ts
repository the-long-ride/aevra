import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { evaluateAndDecideCommand } from '../src/command-decision-bridge.js';

test('evaluateAndDecideCommand: throws if session or lease is missing', async () => {
  const mockContext: any = {
    sessions: { get: () => null },
  };

  await assert.rejects(
    evaluateAndDecideCommand(mockContext, 'ses-1', {
      commandRequest: { kind: 'argv', argv: ['ls'], executionMode: 'host' },
      permissionMatcher: 'shell:ls',
      rawDestinations: [],
      isYolo: false,
      yoloMode: 'workspace',
    }),
    /Session required/,
  );

  const mockNoLease: any = {
    sessions: {
      get: () => ({ actor: 'operator' }),
      activeLease: () => null,
      leases: () => [],
    },
  };
  await assert.rejects(
    evaluateAndDecideCommand(mockNoLease, 'ses-1', {
      commandRequest: { kind: 'argv', argv: ['ls'], executionMode: 'host' },
      permissionMatcher: 'shell:ls',
      rawDestinations: [],
      isYolo: false,
      yoloMode: 'workspace',
    }),
    /workspace access first|Select a workspace first/i,
  );
});

test('evaluateAndDecideCommand: evaluates npm script trust against rule predicates', async () => {
  const tempDir = path.join(tmpdir(), `aevra-bridge-eval-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  const pkgContent = JSON.stringify({ scripts: { build: 'tsc' } });
  writeFileSync(path.join(tempDir, 'package.json'), pkgContent);

  try {
    const session = { actor: 'operator' };
    const lease = { workspaceId: 'ws-1', capabilities: ['commands.run'] };
    const rulePredicate = {
      version: 2,
      application: 'npm',
      operation: ['run', 'build'],
      scriptName: 'build',
      scriptFingerprint: 'wrong_fp',
      allowedModifiers: [],
      allowedOptions: [],
      positionalConstraint: 'workspace-paths',
      targetScope: 'workspace',
      backends: ['host'],
      dialects: ['direct'],
      executableFingerprint: '*',
      wrapperFingerprints: ['*'],
    };

    const mockContext: any = {
      sessions: {
        get: () => session,
        activeLease: () => lease,
        leases: () => [lease],
      },
      workspaces: {
        getLocal: () => ({ id: 'ws-1', hostRoot: tempDir }),
        capabilityRoots: () => [
          { id: 'r1', logicalPrefix: '/work', hostRoot: tempDir, capabilities: ['commands.run'] },
        ],
      },
      deps: {
        permissions: {
          listRules: () => [
            {
              version: 2,
              id: 'r1',
              effect: 'allow',
              capability: 'commands.run',
              status: 'active',
              workspaceId: 'ws-1',
              actor: 'operator',
              predicate_json: JSON.stringify(rulePredicate),
            },
            {
              // Malformed predicate
              version: 2,
              id: 'r2',
              effect: 'allow',
              capability: 'commands.run',
              status: 'active',
              workspaceId: 'ws-1',
              predicate_json: 'invalid json',
            },
          ],
        },
      },
    };

    const { analysis, decision } = await evaluateAndDecideCommand(mockContext, 'ses-1', {
      commandRequest: {
        kind: 'argv',
        argv: ['npm', 'run', 'build'],
        cwdLogical: '/work',
        executionMode: 'host',
      },
      permissionMatcher: 'npm:run:build',
      rawDestinations: [],
      isYolo: false,
      yoloMode: 'workspace',
    });

    assert.ok(analysis);
    assert.equal(decision.outcome, 'approval'); // script changed fingerprint yields approval
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('evaluateAndDecideCommand: allows ordinary command under unrestricted YOLO', async () => {
  const tempDir = path.join(tmpdir(), `aevra-bridge-yolo-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    const session = { actor: 'operator' };
    const lease = { workspaceId: 'ws-1', capabilities: ['commands.run'] };

    const mockContext: any = {
      sessions: {
        get: () => session,
        activeLease: () => lease,
        leases: () => [lease],
      },
      workspaces: {
        getLocal: () => ({ id: 'ws-1', hostRoot: tempDir }),
        capabilityRoots: () => [
          { id: 'r1', logicalPrefix: '/work', hostRoot: tempDir, capabilities: ['commands.run'] },
        ],
      },
      deps: {
        permissions: {
          listRules: () => [],
        },
      },
      oneTimeCapabilities: new Set(),
    };

    const { decision } = await evaluateAndDecideCommand(mockContext, 'ses-1', {
      commandRequest: {
        kind: 'argv',
        argv: ['git', 'status'],
        cwdLogical: '/work',
        executionMode: 'host',
      },
      permissionMatcher: 'git:status',
      rawDestinations: [],
      isYolo: true,
      yoloMode: 'unrestricted',
    });

    assert.equal(decision.outcome, 'allow');

    // Test with networkApproval present
    const { decision: netApprovalDecision } = await evaluateAndDecideCommand(mockContext, 'ses-1', {
      commandRequest: {
        kind: 'argv',
        argv: ['git', 'push'],
        cwdLogical: '/work',
        executionMode: 'host',
      },
      permissionMatcher: 'git:push',
      rawDestinations: ['github.com'],
      networkApproval: { family: 'domain:github.com', capability: 'network.outbound' } as any,
      isYolo: false,
      yoloMode: 'workspace',
    });
    assert.equal(netApprovalDecision.outcome, 'approval');
    assert.ok(netApprovalDecision.reasons.some((r) => r.code === 'NETWORK_DESTINATION_REQUIRED'));

    // Test with network needed but network capability missing
    const { decision: missingNetDecision } = await evaluateAndDecideCommand(mockContext, 'ses-1', {
      commandRequest: {
        kind: 'argv',
        argv: ['git', 'push'],
        cwdLogical: '/work',
        executionMode: 'host',
      },
      permissionMatcher: 'git:push',
      rawDestinations: ['github.com'],
      isYolo: false,
      yoloMode: 'workspace',
    });
    assert.equal(missingNetDecision.outcome, 'approval');
    assert.ok(missingNetDecision.reasons.some((r) => r.code === 'NETWORK_REQUIRED'));

    // Test with commands.run capability missing in lease
    const noCmdLeaseContext: any = {
      ...mockContext,
      sessions: {
        ...mockContext.sessions,
        activeLease: () => ({ workspaceId: 'ws-1', capabilities: [] }),
        leases: () => [{ workspaceId: 'ws-1', capabilities: [] }],
      },
    };
    const { decision: noCmdDecision } = await evaluateAndDecideCommand(noCmdLeaseContext, 'ses-1', {
      commandRequest: {
        kind: 'argv',
        argv: ['git', 'status'],
        cwdLogical: '/work',
        executionMode: 'host',
      },
      permissionMatcher: 'git:status',
      rawDestinations: [],
      isYolo: false,
      yoloMode: 'workspace',
    });
    assert.equal(noCmdDecision.outcome, 'approval');
    assert.ok(noCmdDecision.reasons.some((r) => r.code === 'CAPABILITY_MISSING'));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('evaluateAndDecideCommand: default logical cwd root is inside production workspace root', async () => {
  const tempDir = path.join(tmpdir(), `aevra-default-cwd-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  try {
    const lease = { workspaceId: 'ws-1', capabilities: ['commands.run'] };
    const context: any = {
      sessions: {
        get: () => ({ actor: 'operator' }),
        activeLease: () => lease,
        leases: () => [lease],
      },
      workspaces: {
        getLocal: () => ({ id: 'ws-1', hostRoot: tempDir }),
        capabilityRoots: () => [
          { id: 'root', logicalPrefix: '/', hostRoot: tempDir, capabilities: ['commands.run'] },
        ],
      },
      deps: { permissions: { listRules: () => [] } },
      oneTimeCapabilities: new Set(),
    };

    const { analysis } = await evaluateAndDecideCommand(context, 's1', {
      commandRequest: {
        kind: 'argv',
        argv: ['git', 'status'],
        cwdLogical: '/',
        executionMode: 'host',
      },
      permissionMatcher: 'git:status',
      rawDestinations: [],
      isYolo: false,
      yoloMode: 'workspace',
    });
    assert.equal(analysis.scope, 'inside');
    assert.equal(
      path.resolve(analysis.nodes[0]?.canonicalCwdCandidates?.[0] ?? ''),
      await realpath(tempDir),
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('evaluateAndDecideCommand: unrestricted YOLO overrides current network deny for non-critical command', async () => {
  const tempDir = path.join(tmpdir(), `aevra-network-deny-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  try {
    const lease = { workspaceId: 'ws-1', capabilities: ['commands.run', 'network'] };
    const context: any = {
      sessions: {
        get: () => ({ actor: 'operator' }),
        activeLease: () => lease,
        leases: () => [lease],
        isYolo: () => true,
      },
      workspaces: {
        getLocal: () => ({ id: 'ws-1', hostRoot: tempDir }),
        capabilityRoots: () => [
          { id: 'root', logicalPrefix: '/', hostRoot: tempDir, capabilities: ['commands.run'] },
        ],
      },
      deps: {
        operations: {
          classifyNetwork: (destination: string) => ({
            known: false,
            family: `domain:${destination}`,
            destination,
          }),
        },
        permissions: {
          listRules: () => [],
          decide: (input: any) =>
            input.capability === 'network'
              ? { outcome: 'deny', reason: 'blocked now' }
              : { outcome: 'allow', reason: 'allowed' },
        },
      },
      oneTimeCapabilities: new Set(),
    };
    const { decision } = await evaluateAndDecideCommand(context, 's1', {
      commandRequest: {
        kind: 'argv',
        argv: ['git', 'push'],
        cwdLogical: '/',
        executionMode: 'host',
        networkDestinations: ['example.com'],
      },
      permissionMatcher: 'git:push',
      rawDestinations: ['example.com'],
      isYolo: true,
      yoloMode: 'unrestricted',
      riskFloor: 'HIGH',
    });
    assert.equal(decision.outcome, 'allow');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
