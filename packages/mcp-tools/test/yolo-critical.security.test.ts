import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeCapability, gated } from '../src/authorization.js';

/**
 * Minimal runtime context with YOLO on and `policy.critical.alwaysConfirm` set.
 * The documented security model promises critical operations never execute
 * unattended; YOLO used to short-circuit ahead of that check.
 */
function fixture(options: {
  yolo: boolean;
  alwaysConfirm: boolean;
  yoloMode?: string;
  capabilities?: string[];
  permission?: { outcome: 'allow' | 'deny' | 'approval'; reason: string };
}) {
  const requests: any[] = [];
  const lease: any = {
    id: 'l1',
    workspaceId: 'w1',
    actor: 'oauth:ChatGPT',
    capabilities: options.capabilities ?? [],
    expiresAt: 'later',
  };
  const session: any = { id: 's1', actor: 'oauth:ChatGPT', subject: 'subject' };
  const context: any = {
    sessions: {
      get: () => session,
      activeLease: () => lease,
      leaseForWorkspace: () => lease,
      leases: () => [lease],
      isYolo: () => options.yolo,
    },
    workspaces: { capabilityRoots: () => [] },
    reads: {},
    approvals: {
      request: async (input: any) => {
        requests.push(input);
        return { status: 'approval_pending', requestId: 'req1' };
      },
      status: () => ({ state: 'PENDING' }),
    },
    deps: {
      ...(options.permission ? { permissions: { decide: () => options.permission } } : {}),
      settings: {
        get: (key: string, fallback: any) => {
          if (key === 'policy.critical.alwaysConfirm') return options.alwaysConfirm;
          if (key === 'policy.yolo') return { mode: options.yoloMode ?? 'unrestricted' };
          return fallback;
        },
      },
    },
    oneTimeCapabilities: new Set<string>(),
  };
  return { context, requests };
}

const CRITICAL = {
  family: 'sudo:run',
  capability: 'commands.run' as const,
  risk: 'CRITICAL' as const,
  argsHash: 'h',
};
const LOW = {
  family: 'npm:test',
  capability: 'commands.run' as const,
  risk: 'LOW' as const,
  argsHash: 'h',
};

test('gated: YOLO does not bypass approval for critical work when alwaysConfirm is set', async () => {
  const fx = fixture({ yolo: true, alwaysConfirm: true });
  const result: any = await gated(fx.context, 's1', CRITICAL, {}, {}, async () => 'EXECUTED');
  assert.notEqual(result, 'EXECUTED', 'critical work must not run unattended under YOLO');
  assert.equal(result.status, 'approval_pending');
  assert.equal(fx.requests.length, 1);
});

test('gated: YOLO still bypasses approval for non-critical work', async () => {
  const fx = fixture({ yolo: true, alwaysConfirm: true });
  assert.equal(await gated(fx.context, 's1', LOW, {}, {}, async () => 'EXECUTED'), 'EXECUTED');
});

test('gated: YOLO still requires critical approval when alwaysConfirm is off', async () => {
  const fx = fixture({
    yolo: true,
    alwaysConfirm: false,
    capabilities: ['commands.run'],
  });
  const result: any = await gated(fx.context, 's1', CRITICAL, {}, {}, async () => 'EXECUTED');
  assert.equal(result.status, 'approval_pending');
  assert.equal(fx.requests.length, 1);
});

test('gated: workspace-scoped YOLO stops at critical work even without alwaysConfirm', async () => {
  const fx = fixture({ yolo: true, alwaysConfirm: false, yoloMode: 'workspace' });
  const result: any = await gated(fx.context, 's1', CRITICAL, {}, {}, async () => 'EXECUTED');
  assert.equal(result.status, 'approval_pending');
});

test('authorizeCapability: command YOLO defers CRITICAL confirmation to structured command policy', async () => {
  const fx = fixture({
    yolo: true,
    alwaysConfirm: true,
    permission: { outcome: 'deny', reason: 'remembered deny' },
  });
  const gate: any = await authorizeCapability(
    fx.context,
    's1',
    'commands.run',
    { tool: 'shell_run', args: {} },
    'shell:bash:*',
    'CRITICAL',
  );
  assert.equal(gate.authorization.capability, 'commands.run');
  assert.equal(
    fx.requests.length,
    0,
    'pre-analysis gate must not create a generic critical ticket',
  );
});

test('authorizeCapability: YOLO still grants non-critical capabilities directly', async () => {
  const fx = fixture({ yolo: true, alwaysConfirm: true });
  const gate: any = await authorizeCapability(
    fx.context,
    's1',
    'files.write',
    { tool: 'file_write', args: {} },
    '*',
    'HIGH',
  );
  assert.equal(gate.authorization.capability, 'files.write');
});

test('authorizeCapability: active command YOLO bypasses remembered command and network DENY preflight', async () => {
  const permission = { outcome: 'deny' as const, reason: 'remembered deny' };

  const commandFx = fixture({ yolo: true, alwaysConfirm: false, permission });
  const commandGate: any = await authorizeCapability(
    commandFx.context,
    's1',
    'commands.run',
    { tool: 'command_run', args: {} },
    'git:status',
    'HIGH',
  );
  assert.equal(commandGate.authorization.capability, 'commands.run');

  const networkFx = fixture({ yolo: true, alwaysConfirm: false, permission });
  const networkGate: any = await authorizeCapability(
    networkFx.context,
    's1',
    'network',
    { tool: 'command_run', args: { networkDestinations: ['example.com'] } },
    'domain:example.com',
    'MEDIUM',
  );
  assert.equal(networkGate.authorization.capability, 'network');
});
