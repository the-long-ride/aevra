import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  bindCommandApproval,
  clearExpiredBindings,
} from '../../../apps/core/src/approvals/command-binding.js';
import { evaluateAndDecideCommand } from '../src/command-decision-bridge.js';
import { resumeApproval } from '../src/approval-resume.js';

test('command resume rejects a network destination that became explicitly denied', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aevra-network-freshness-'));
  let denyNetwork = false;
  let executions = 0;
  const lease = { workspaceId: 'w1', capabilities: ['commands.run', 'network'] };
  const request: any = {
    kind: 'argv',
    executable: 'git',
    argv: ['git', 'push'],
    cwdLogical: '/',
    env: {},
    executionMode: 'host',
    networkDestinations: ['example.com'],
  };
  const ticket: any = {
    id: 'req-network',
    actor: 'connector:CLI',
    sessionId: 's1',
    workspaceId: 'w1',
    operation: {
      family: 'git:push',
      capability: 'commands.run',
      risk: 'HIGH',
      argsHash: 'x',
    },
    expectedState: {},
    risk: 'HIGH',
    state: 'APPROVED',
    expiresAt: 'later',
    decisionScope: 'once',
  };

  const context: any = {
    sessions: {
      get: () => ({ id: 's1', actor: 'connector:CLI' }),
      activeLease: () => lease,
      leaseForWorkspace: (_sessionId: string, workspaceId: string) =>
        workspaceId === 'w1' ? lease : null,
      leases: () => [lease],
      isYolo: () => false,
    },
    workspaces: {
      getLocal: () => ({ id: 'w1', hostRoot: root }),
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
      operations: {
        classifyNetwork: (destination: string) => ({
          known: false,
          family: `domain:${destination}`,
          destination,
        }),
        runCommand: async () => {
          executions += 1;
          return { ran: true };
        },
      },
      permissions: {
        listRules: () => [],
        decide: (input: any) =>
          input.capability === 'network'
            ? denyNetwork
              ? { outcome: 'deny', reason: 'destination blocked' }
              : { outcome: 'allow', reason: 'destination allowed' }
            : { outcome: 'approval', reason: 'command approval required' },
      },
    },
    oneTimeCapabilities: new Set<string>(),
    worker: { execute: async () => ({ ok: true, value: {} }) },
    reads: {},
    processStart: async () => null,
    callInner: async () => null,
  };

  try {
    const { analysis } = await evaluateAndDecideCommand(context, 's1', {
      commandRequest: request,
      permissionMatcher: 'git:push',
      rawDestinations: ['example.com'],
      isYolo: false,
      yoloMode: 'workspace',
      riskFloor: 'HIGH',
    });
    ticket.payload = {
      tool: 'command_run',
      permissionMatcher: 'git:push',
      commandAnalysis: analysis,
      commandRequest: request,
      riskFloor: 'HIGH',
      networkApproval: null,
      args: {
        command: { executable: 'git', args: ['push'], cwdLogical: '/', env: {} },
        executionMode: 'host',
        networkPolicy: {
          mode: 'allow-rules',
          destinations: ['example.com'],
          enforcement: 'backend',
        },
      },
    };
    context.approvals = {
      status: () => ticket,
      resume: async (_id: string, validate: any, execute: any) => {
        const validation = await validate(ticket);
        return validation.ok ? execute(ticket) : validation;
      },
    };
    bindCommandApproval(ticket.id, analysis, 's1', 'w1');

    denyNetwork = true;
    assert.deepEqual(await resumeApproval(context, 's1', ticket.id), {
      ok: false,
      reason: 'permission policy changed',
    });
    assert.equal(executions, 0);
  } finally {
    clearExpiredBindings(-1);
    rmSync(root, { recursive: true, force: true });
  }
});
