import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorizeCapability,
  authorizeImmutableSecurityApproval,
  gated,
} from '../src/authorization.js';
import { oneTimeKey } from '../src/service-helpers.js';

function fixture(
  options: {
    yolo?: boolean;
    capabilities?: string[];
    permission?: any;
    approvalStatus?: 'approval_pending' | 'approved';
    actor?: string;
    switchResult?: any;
    bindings?: any;
  } = {},
) {
  const requests: any[] = [];
  const lease: any = {
    id: 'l1',
    workspaceId: 'w1',
    actor: options.actor ?? 'oauth:ChatGPT',
    capabilities: options.capabilities ?? [],
    expiresAt: 'later',
  };
  const session: any = { id: 's1', actor: options.actor ?? 'oauth:ChatGPT', subject: 'subject' };
  const sessions: any = {
    get: () => session,
    activeLease: () => lease,
    leaseForWorkspace: (_s: string, id: string) => (id === lease.workspaceId ? lease : null),
    leases: () => [lease],
    isYolo: () => options.yolo ?? false,
    switchWorkspace: async (...args: any[]) =>
      options.switchResult ?? { status: 'admitted', lease: { ...lease, workspaceId: args[1] } },
    connectionIdentity: () => ({ actor: session.actor, subject: session.subject }),
  };
  const workspaces: any = {
    getLocal: (value: string) =>
      value === 'w1' || value === 'One'
        ? { id: 'w1', name: 'One', description: 'desc', hostRoot: '/root' }
        : value === 'w2' || value === 'Two'
          ? { id: 'w2', name: 'Two', description: 'desc2', hostRoot: '/root2' }
          : null,
    listRemote: () => [
      { id: 'w1', name: 'One', description: 'desc' },
      { id: 'w2', name: 'Two', description: 'desc2' },
    ],
    capabilityRoots: () => [],
  };
  const approvals: any = {
    request: async (input: any) => {
      requests.push(input);
      return { status: options.approvalStatus ?? 'approval_pending', requestId: 'req1' };
    },
    status: () => ({ state: 'PENDING' }),
  };
  const context: any = {
    sessions,
    workspaces,
    worker: { execute: async () => ({ ok: true, value: {} }) },
    reads: {},
    approvals,
    deps: {
      permissions:
        options.permission === undefined ? undefined : { decide: () => options.permission },
      connectorBindings: () => options.bindings ?? null,
      settings: { get: () => false },
    },
    oneTimeCapabilities: new Set<string>(),
    processStart: async () => ({}),
    callInner: async () => ({ resumed: true }),
  };
  return { context, requests, lease, session, approvals };
}

test('authorize capability covers YOLO lease one-time allow permission allow deny and missing approval service', async () => {
  for (const setup of [
    { yolo: true },
    { capabilities: ['files.write'] },
    { permission: { outcome: 'allow', reason: 'remembered' } },
  ]) {
    const fx = fixture(setup);
    const gate: any = await authorizeCapability(
      fx.context,
      's1',
      'files.write',
      { tool: 'file_write', args: {} },
      '*',
      'HIGH',
    );
    assert.equal(gate.authorization.capability, 'files.write');
  }

  const once = fixture();
  once.context.oneTimeCapabilities.add(oneTimeKey('s1', 'files.write', '*'));
  assert.ok(
    'authorization' in
      (await authorizeCapability(
        once.context,
        's1',
        'files.write',
        { tool: 'file_write', args: {} },
        'specific',
        'HIGH',
      )),
  );

  const denied = fixture({ permission: { outcome: 'deny', reason: 'blocked' } });
  await assert.rejects(
    () =>
      authorizeCapability(
        denied.context,
        's1',
        'files.write',
        { tool: 'file_write', args: {} },
        '*',
        'HIGH',
      ),
    (e: any) => e.code === 'CAPABILITY_REQUIRED' && e.message === 'blocked',
  );
  const missing = fixture();
  missing.context.approvals = undefined;
  await assert.rejects(
    () =>
      authorizeCapability(
        missing.context,
        's1',
        'files.write',
        { tool: 'file_write', args: {} },
        '*',
        'HIGH',
      ),
    (e: any) => e.code === 'APPROVAL_PENDING',
  );
});

test('authorize capability creates wildcard and matcher pending requests with exact metadata', async () => {
  const wildcard = fixture();
  const response: any = await authorizeCapability(
    wildcard.context,
    's1',
    'files.write',
    { tool: 'file_write', args: { path: '/a' } },
    '*',
    'MEDIUM',
  );
  assert.equal(response.response.requiredCapability, 'files.write');
  assert.equal(wildcard.requests[0].operation.family, 'capability:files.write');
  assert.equal(wildcard.requests[0].payload.permissionMatcher, '*');

  const matcher = fixture();
  await authorizeCapability(
    matcher.context,
    's1',
    'commands.run',
    { tool: 'command_run', args: {} },
    'npm:test',
    'HIGH',
  );
  assert.equal(matcher.requests[0].operation.family, 'npm:test');
  assert.equal(matcher.requests[0].operation.risk, 'HIGH');
});

test('immutable security approval covers one-time, missing service and pending response', async () => {
  const once = fixture();
  once.context.oneTimeCapabilities.add(oneTimeKey('s1', 'files.write', '*'));
  assert.ok(
    'authorization' in
      (await authorizeImmutableSecurityApproval(
        once.context,
        's1',
        'files.write',
        { tool: 'file_write', args: {} },
        'security:file',
        'CRITICAL',
      )),
  );

  const missing = fixture();
  missing.context.approvals = undefined;
  await assert.rejects(
    () =>
      authorizeImmutableSecurityApproval(
        missing.context,
        's1',
        'files.write',
        { tool: 'file_write', args: {} },
        'security:file',
      ),
    (e: any) => e.code === 'APPROVAL_PENDING',
  );
  const pending = fixture();
  const gate: any = await authorizeImmutableSecurityApproval(
    pending.context,
    's1',
    'files.write',
    { tool: 'file_write', args: {} },
    'security:file',
  );
  assert.equal(gate.response.securityApprovalScope, 'once');
  assert.equal(gate.response.permissionMatcher, '*');
  assert.equal(pending.requests[0].payload.securityOnce, true);
});

test('gated covers YOLO one-time low-risk permission allow deny command step-up and pending approval', async () => {
  let executions = 0;
  const execute = async () => ++executions;
  const normalized: any = {
    family: 'files:write',
    capability: 'files.write',
    risk: 'HIGH',
    argsHash: 'x',
  };

  assert.equal(await gated(fixture({ yolo: true }).context, 's1', normalized, {}, {}, execute), 1);
  const once = fixture();
  once.context.oneTimeCapabilities.add(oneTimeKey('s1', 'files.write', 'files:write'));
  assert.equal(await gated(once.context, 's1', normalized, {}, {}, execute), 2);
  assert.equal(
    await gated(fixture().context, 's1', { ...normalized, risk: 'LOW' }, {}, {}, execute),
    3,
  );
  assert.equal(
    await gated(
      fixture({ permission: { outcome: 'allow', reason: 'yes' } }).context,
      's1',
      normalized,
      {},
      {},
      execute,
    ),
    4,
  );

  await assert.rejects(
    () =>
      gated(
        fixture({ permission: { outcome: 'deny', reason: 'no' } }).context,
        's1',
        normalized,
        {},
        {},
        execute,
      ),
    (e: any) => e.code === 'CAPABILITY_REQUIRED' && e.message === 'no',
  );
  const missing = fixture();
  missing.context.approvals = undefined;
  await assert.rejects(
    () => gated(missing.context, 's1', normalized, {}, {}, execute),
    (e: any) => e.code === 'APPROVAL_PENDING',
  );
  const pending = fixture();
  const result: any = await gated(
    pending.context,
    's1',
    normalized,
    { a: 1 },
    { head: 'x' },
    execute,
  );
  assert.equal(result.status, 'approval_pending');
  assert.equal(pending.requests[0].expectedState.head, 'x');

  const command = fixture({ permission: { outcome: 'allow', reason: 'remembered' } });
  const commandResult: any = await gated(
    command.context,
    's1',
    { family: 'npm:test', capability: 'commands.run', risk: 'LOW', argsHash: 'x' } as any,
    {},
    {},
    execute,
  );
  assert.equal(commandResult, 5);

  const newCommand = fixture();
  const newCommandResult: any = await gated(
    newCommand.context,
    's1',
    { family: 'npm:test', capability: 'commands.run', risk: 'LOW', argsHash: 'x' } as any,
    {},
    {},
    execute,
  );
  assert.equal(newCommandResult.status, 'approval_pending');
});

test('gated forces CRITICAL approval when alwaysConfirm is enabled even for remembered allow', async () => {
  const fx = fixture({ permission: { outcome: 'allow', reason: 'remembered' } });
  fx.context.deps.settings.get = () => true;
  const result: any = await gated(
    fx.context,
    's1',
    { family: 'danger', capability: 'commands.run', risk: 'CRITICAL', argsHash: 'x' } as any,
    {},
    {},
    async () => 'executed',
  );
  assert.equal(result.status, 'approval_pending');
  assert.equal(fx.requests[0].operation.risk, 'CRITICAL');
});
