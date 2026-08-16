import assert from 'node:assert/strict';
import test from 'node:test';
import { resumeApproval } from '../src/approval-resume.js';

function ticket(overrides: any = {}) {
  return {
    id: 'req1',
    actor: 'oauth:ChatGPT',
    sessionId: 's1',
    workspaceId: 'w1',
    operation: { family: 'files:write', capability: 'files.write', risk: 'HIGH', argsHash: 'x' },
    payload: { tool: 'command_run', args: { command: { executable: 'node', args: [], env: {} } } },
    expectedState: {},
    risk: 'HIGH',
    state: 'APPROVED',
    expiresAt: 'later',
    decisionScope: 'once',
    ...overrides,
  };
}

function fixture(t: any, options: any = {}) {
  const currentSession =
    options.session === null
      ? null
      : {
          id: options.sessionId ?? 's1',
          actor: options.actor ?? 'oauth:ChatGPT',
          subject: options.subject ?? 'subject',
        };
  const originalSession = {
    id: t.sessionId,
    actor: t.actor,
    subject: options.originalSubject ?? 'subject',
  };
  const lease =
    options.lease === null
      ? null
      : {
          workspaceId: options.workspaceId ?? 'w1',
          capabilities: options.capabilities ?? ['files.write'],
        };
  const validations: any[] = [];
  const context: any = {
    sessions: {
      get: () => currentSession,
      activeLease: () => lease,
      leases: () => (lease ? [lease] : []),
      leaseForWorkspace: (_s: string, id: string) => (lease?.workspaceId === id ? lease : null),
      connectionIdentity: (id: string) => {
        const row = id === t.sessionId ? originalSession : currentSession;
        return row ? { actor: row.actor, subject: row.subject } : null;
      },
      switchWorkspace: async () =>
        options.switchResult ?? {
          status: 'admitted',
          lease: { workspaceId: 'w1', capabilities: ['files.read'] },
        },
      grantConnectionWorkspace: () =>
        options.grantResult ?? { workspaceId: 'w1', capabilities: ['files.read'] },
    },
    workspaces: {
      getLocal: (id: string) =>
        options.workspaceMissing
          ? null
          : { id, name: 'One', description: 'desc', hostRoot: '/root' },
      capabilityRoots: () => [],
      listRemote: () => [{ id: 'w1', name: 'One' }],
    },
    worker: { execute: async () => ({ ok: true, value: { stdout: 'abc123\n' } }) },
    reads: {},
    approvals: {
      status: () => t,
      resume: async (_id: string, validate: any, execute: any) => {
        const checked = await validate(t);
        validations.push(checked);
        return checked.ok ? execute(t) : checked;
      },
    },
    deps: {
      permissions:
        options.permission === undefined ? undefined : { decide: () => options.permission },
      operations: { runCommand: async () => ({ ran: true }) },
    },
    oneTimeCapabilities: new Set<string>(),
    processStart: async () => ({ process: true }),
    callInner: async (_s: string, tool: string, args: any) => ({ tool, args }),
  };
  return { context, validations };
}

test('resume returns null for unavailable approvals or missing tickets and returns non-approved ticket unchanged', async () => {
  const base = fixture(ticket());
  base.context.approvals = undefined;
  assert.equal(await resumeApproval(base.context, 's1', 'req1'), null);
  const missing = fixture(ticket());
  missing.context.approvals.status = () => null;
  assert.equal(await resumeApproval(missing.context, 's1', 'req1'), null);
  const pendingTicket = ticket({ state: 'PENDING' });
  const pending = fixture(pendingTicket);
  assert.equal(await resumeApproval(pending.context, 's1', 'req1'), pendingTicket);
});

test('ordinary approval revalidation rejects changed session workspace permission capability and repository', async () => {
  const cases = [
    [{ sessionId: 'different' }, 'session changed'],
    [{ actor: 'oauth:Other' }, 'session changed'],
    [{ lease: null }, 'workspace changed'],
    [{ workspaceId: 'w2' }, 'workspace changed'],
    [{ permission: { outcome: 'deny', reason: 'blocked' } }, 'permission policy changed'],
    [{ capabilities: [] }, 'capability changed'],
  ] as const;
  for (const [options, reason] of cases) {
    const fx = fixture(ticket(), options);
    const result: any = await resumeApproval(fx.context, 's1', 'req1');
    assert.deepEqual(result, { ok: false, reason });
  }

  const repoTicket = ticket({ expectedState: { head: 'expected' } });
  const repo = fixture(repoTicket);
  repo.context.worker.execute = async () => ({ ok: true, value: { stdout: 'different\n' } });
  assert.deepEqual(await resumeApproval(repo.context, 's1', 'req1'), {
    ok: false,
    reason: 'repository state changed',
  });
});

test('ordinary approval accepts remembered permission one-time capability and matching repository state', async () => {
  const permission = fixture(ticket(), { capabilities: [], permission: { outcome: 'allow' } });
  assert.deepEqual(await resumeApproval(permission.context, 's1', 'req1'), { ran: true });

  const once = fixture(ticket(), { capabilities: [] });
  once.context.oneTimeCapabilities.add('s1\u0000files.write\u0000files:write');
  assert.deepEqual(await resumeApproval(once.context, 's1', 'req1'), { ran: true });

  const repoTicket = ticket({ expectedState: { head: 'abc123' } });
  const repo = fixture(repoTicket);
  assert.deepEqual(await resumeApproval(repo.context, 's1', 'req1'), { ran: true });
});

test('workspace admission validates OAuth connection scope session scope non-OAuth and workspace existence', async () => {
  const connection = ticket({
    operation: {
      family: 'workspace:select',
      capability: 'files.read',
      risk: 'MEDIUM',
      argsHash: 'x',
    },
    payload: { tool: 'workspace_select', workspaceId: 'w1', profileId: 'read-only' },
    decisionScope: 'connection',
  });
  assert.equal(
    ((await resumeApproval(fixture(connection).context, 's1', 'req1')) as any).status,
    'selected',
  );
  const changed = fixture(connection, { sessionId: 's2', subject: 'new-subject' });
  assert.deepEqual(await resumeApproval(changed.context, 's2', 'req1'), {
    ok: false,
    reason: 'OAuth connection changed',
  });

  const once = { ...connection, decisionScope: 'once' };
  const changedSession = fixture(once, { sessionId: 'new' });
  assert.deepEqual(await resumeApproval(changedSession.context, 's1', 'req1'), {
    ok: false,
    reason: 'session changed',
  });

  const staticTicket = { ...once, actor: 'connector:CLI' };
  const staticChanged = fixture(staticTicket, { sessionId: 'new', actor: 'connector:CLI' });
  assert.deepEqual(await resumeApproval(staticChanged.context, 's1', 'req1'), {
    ok: false,
    reason: 'session changed',
  });

  const missingWorkspace = fixture(once, { workspaceMissing: true });
  assert.deepEqual(await resumeApproval(missingWorkspace.context, 's1', 'req1'), {
    ok: false,
    reason: 'workspace no longer exists',
  });
});

test('capability request validates connection identity workspace and active lease before replay', async () => {
  const cap = ticket({
    operation: { family: 'npm:test', capability: 'commands.run', risk: 'HIGH', argsHash: 'x' },
    payload: {
      tool: 'capability_request',
      permissionMatcher: 'npm:test',
      original: { tool: 'command_run', args: { x: 1 } },
    },
  });
  const good = fixture(cap, { capabilities: ['commands.run'] });
  assert.deepEqual(await resumeApproval(good.context, 's1', 'req1'), {
    tool: 'command_run',
    args: { x: 1 },
  });
  assert.equal(good.context.oneTimeCapabilities.size, 0);

  for (const [options, reason] of [
    [{ sessionId: 's2', subject: 'changed' }, 'OAuth connection changed'],
    [{ workspaceMissing: true }, 'workspace no longer exists'],
    [{ workspaceId: 'w2' }, 'workspace changed'],
    [{ lease: null }, 'workspace changed'],
  ] as const) {
    const fx = fixture(cap, options);
    const currentSessionId = options.sessionId === 's2' ? 's2' : 's1';
    assert.deepEqual(await resumeApproval(fx.context, currentSessionId, 'req1'), {
      ok: false,
      reason,
    });
  }

  const staticCap = { ...cap, actor: 'connector:CLI' };
  const staticChanged = fixture(staticCap, { actor: 'connector:CLI', sessionId: 'new' });
  assert.deepEqual(await resumeApproval(staticChanged.context, 's1', 'req1'), {
    ok: false,
    reason: 'session changed',
  });
});
