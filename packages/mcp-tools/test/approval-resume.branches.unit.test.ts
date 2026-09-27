import assert from 'node:assert/strict';
import test from 'node:test';
import { resumeApproval } from '../src/approval-resume.js';

function ticket(tool: string, args: any = {}, overrides: any = {}) {
  return {
    id: 'req1',
    actor: 'oauth:ChatGPT',
    sessionId: 's1',
    workspaceId: 'w1',
    operation: { family: 'files:write', capability: 'files.write', risk: 'HIGH', argsHash: 'x' },
    payload: { tool, args },
    expectedState: {},
    state: 'APPROVED',
    decisionScope: 'once',
    ...overrides,
  };
}

const SELECT_OP = {
  family: 'workspace:select',
  capability: 'files.read',
  risk: 'MEDIUM',
  argsHash: 'x',
};
const CAP_OP = { family: 'npm:test', capability: 'commands.run', risk: 'HIGH', argsHash: 'x' };

function fixture(t: any, o: any = {}) {
  const calls: any[] = [];
  const lease = o.lease ?? {
    workspaceId: 'w1',
    capabilities: ['files.write', 'git.commit', 'git.push'],
  };
  const session = o.session === undefined ? { id: 's1', actor: t.actor } : o.session;
  const context: any = {
    sessions: {
      get: () => session,
      activeLease: () => lease,
      leases: () => [lease],
      leaseForWorkspace: o.noLeaseForWorkspace ? () => undefined : () => lease,
      connectionIdentity: () => o.identity ?? null,
      switchWorkspace: async (...args: any[]) => {
        calls.push(['switch', ...args]);
        return { status: 'admitted', lease: { workspaceId: 'w1', capabilities: ['files.read'] } };
      },
    },
    workspaces: {
      getLocal: (id: string) =>
        id === 'w1' ? { id, name: 'One', description: 'd', hostRoot: o.hostRoot } : null,
      capabilityRoots: () => [],
    },
    worker: {
      execute: async (input: any) => {
        calls.push(['worker', input]);
        if (input.operation.kind === 'git.log') return { ok: true, value: { stdout: o.head ?? '' } };
        return { ok: true, value: { kind: input.operation.kind } };
      },
    },
    approvals: {
      status: () => t,
      resume: async (_id: string, validate: any, execute: any, claim?: any) => {
        const checked = await validate(t);
        if (!checked.ok) return checked;
        o.beforeClaim?.(session);
        if (claim) {
          const claimed = await claim(t);
          if (!claimed.ok) return claimed;
        }
        return execute(t);
      },
    },
    deps: {
      manifests: o.manifests,
      processes: o.processes,
    },
    oneTimeCapabilities: new Set<string>(o.oneTime ?? []),
    callInner: async (...args: any[]) => {
      calls.push(['callInner', ...args]);
      return { replayed: args[1] };
    },
  };
  return { context, calls };
}

test('non-approved tickets are returned only to an authorized session', async () => {
  const pending = ticket('file_write', {}, { state: 'PENDING', actor: 'connector:CLI' });
  assert.equal(await resumeApproval(fixture(pending).context, 's1', 'req1'), pending);
  const other = fixture(pending, { session: { id: 's2', actor: 'connector:CLI' } });
  assert.equal(await resumeApproval(other.context, 's1', 'req1'), null);
  const noApprovals = fixture(pending);
  noApprovals.context.approvals = undefined;
  assert.equal(await resumeApproval(noApprovals.context, 's1', 'req1'), null);
  const missing = fixture(pending);
  missing.context.approvals.status = () => null;
  assert.equal(await resumeApproval(missing.context, 's1', 'req1'), null);
});

test('expected repository head is re-read through the active lease before replay', async () => {
  const t = ticket('change_rollback', { changeSetId: 'c1' }, { expectedState: { head: 'abc' } });
  const moved = fixture(t, { noLeaseForWorkspace: true, head: 'def other' });
  assert.deepEqual(await resumeApproval(moved.context, 's1', 'req1'), {
    ok: false,
    reason: 'repository state changed',
  });
  assert.equal(moved.calls[0][1].workspaceId, 'w1');
  const same = fixture(t, { head: 'abc\n' });
  same.context.deps.changes = { rollback: async (id: string) => ({ rolledBack: id }) };
  assert.deepEqual(await resumeApproval(same.context, 's1', 'req1'), { rolledBack: 'c1' });
});

test('the claim step re-verifies authority after validation', async () => {
  const t = ticket('change_rollback', { changeSetId: 'c1' });
  const f = fixture(t, { beforeClaim: (s: any) => (s.actor = 'oauth:Other') });
  assert.deepEqual(await resumeApproval(f.context, 's1', 'req1'), {
    ok: false,
    reason: 'session changed',
  });
});

test('workspace admission rejects missing or mismatched sessions', async () => {
  const t = ticket('workspace_select', { workspaceId: 'w1' }, { operation: SELECT_OP });
  assert.deepEqual(await resumeApproval(fixture(t, { session: null }).context, 's1', 'req1'), {
    ok: false,
    reason: 'session changed',
  });
  const drifted = fixture(t, { session: { id: 's2', actor: t.actor } });
  assert.deepEqual(await resumeApproval(drifted.context, 's1', 'req1'), {
    ok: false,
    reason: 'session changed',
  });
  const conn = { ...t, decisionScope: 'connection' };
  assert.deepEqual(await resumeApproval(fixture(conn).context, 's1', 'req1'), {
    ok: false,
    reason: 'OAuth connection changed',
  });
  const local = ticket('workspace_select', {}, { operation: SELECT_OP, actor: 'connector:CLI' });
  const localDrift = fixture(local, { session: { id: 's1', actor: 'connector:Other' } });
  assert.deepEqual(await resumeApproval(localDrift.context, 's1', 'req1'), {
    ok: false,
    reason: 'session changed',
  });
});

test('frozen workspace select uses local profile defaults, manifests and drain timeout', async () => {
  const local = ticket('workspace_select', {}, { operation: SELECT_OP, actor: 'connector:CLI' });
  const summarized: any[] = [];
  const f = fixture(local, {
    manifests: { summarize: (root: any) => (summarized.push(root), { commands: {} }) },
  });
  const result: any = await resumeApproval(f.context, 's1', 'req1');
  assert.equal(result.status, 'selected');
  assert.deepEqual(summarized, [null], 'missing host root is summarized as null');
  assert.ok(result.manifest);
  const sw = f.calls.find((c) => c[0] === 'switch');
  assert.deepEqual(sw.slice(1), ['s1', 'w1', 'developer', 60_000]);

  const nan = ticket(
    'workspace_select',
    {},
    {
      operation: SELECT_OP,
      actor: 'connector:CLI',
      payload: { tool: 'workspace_select', drainTimeoutMs: 'soon' },
    },
  );
  const g = fixture(nan, { hostRoot: '/root' });
  await resumeApproval(g.context, 's1', 'req1');
  assert.equal(g.calls.find((c) => c[0] === 'switch')[4], 0);

  const elsewhere = ticket(
    'workspace_select',
    {},
    {
      operation: SELECT_OP,
      actor: 'connector:CLI',
      payload: { tool: 'workspace_select', workspaceId: 'w9' },
    },
  );
  await assert.rejects(
    () => resumeApproval(fixture(elsewhere).context, 's1', 'req1'),
    (e: any) => e.code === 'NOT_FOUND',
  );
});

function capTicket(overrides: any = {}, payload: any = {}) {
  return ticket('capability_request', {}, {
    operation: CAP_OP,
    payload: { tool: 'capability_request', original: { tool: 'command_run', args: { a: 1 } }, ...payload },
    ...overrides,
  });
}

test('capability replay validates session, workspace and lease on validate and claim', async () => {
  assert.deepEqual(await resumeApproval(fixture(capTicket(), { session: null }).context, 's1', 'req1'), {
    ok: false,
    reason: 'session changed',
  });
  const local = capTicket({ actor: 'connector:CLI' });
  const drift = fixture(local, { session: { id: 's2', actor: 'connector:CLI' } });
  assert.deepEqual(await resumeApproval(drift.context, 's1', 'req1'), {
    ok: false,
    reason: 'session changed',
  });
  const noWs = capTicket({ actor: 'connector:CLI', workspaceId: 'w9' });
  assert.deepEqual(await resumeApproval(fixture(noWs).context, 's1', 'req1'), {
    ok: false,
    reason: 'workspace no longer exists',
  });
  const wrongLease = fixture(local, {
    noLeaseForWorkspace: true,
    lease: { workspaceId: 'w2', capabilities: [] },
  });
  assert.deepEqual(await resumeApproval(wrongLease.context, 's1', 'req1'), {
    ok: false,
    reason: 'workspace changed',
  });
  const activeOnly = fixture(local, { noLeaseForWorkspace: true });
  assert.deepEqual(await resumeApproval(activeOnly.context, 's1', 'req1'), { replayed: 'command_run' });

  const lost = fixture(local, {
    beforeClaim: () => {
      lost.context.sessions.leaseForWorkspace = () => ({ workspaceId: 'w2' });
    },
  });
  assert.deepEqual(await resumeApproval(lost.context, 's1', 'req1'), {
    ok: false,
    reason: 'workspace changed',
  });
  const dropped = fixture(local, {
    noLeaseForWorkspace: true,
    beforeClaim: () => {
      dropped.context.sessions.activeLease = () => null;
    },
  });
  assert.deepEqual(await resumeApproval(dropped.context, 's1', 'req1'), {
    ok: false,
    reason: 'workspace changed',
  });
});

test('capability replay grants a wildcard one-time key and prefers proxied operations', async () => {
  const local = capTicket({ actor: 'connector:CLI' });
  const f = fixture(local);
  let seen: string[] = [];
  f.context.callInner = async () => {
    seen = [...f.context.oneTimeCapabilities];
    return { ok: true };
  };
  await resumeApproval(f.context, 's1', 'req1');
  assert.deepEqual(seen, ['s1\u0000commands.run\u0000*']);
  assert.equal(f.context.oneTimeCapabilities.size, 0);

  const proxied = capTicket({ actor: 'connector:CLI' }, {
    original: { tool: 'docs__search', proxy: { server: 'docs', tool: 'search' } },
  });
  const p = fixture(proxied);
  p.context.proxyOperation = async (_s: string, proxy: any) => ({ proxied: proxy.server });
  assert.deepEqual(await resumeApproval(p.context, 's1', 'req1'), { proxied: 'docs' });
  const noProxy = fixture(proxied);
  assert.deepEqual(await resumeApproval(noProxy.context, 's1', 'req1'), { replayed: 'docs__search' });
});

test('frozen git replay falls back to requiredLease and honours one-time grants', async () => {
  const commit = ticket('git_commit', { message: 'm' }, { workspaceId: '' });
  const bare = { workspaceId: 'w1', capabilities: ['files.write'] };
  const denied = fixture(commit, { lease: bare });
  denied.context.sessions.leaseForWorkspace = () => null;
  await assert.rejects(
    () => resumeApproval(denied.context, 's1', 'req1'),
    (e: any) => e.code === 'CAPABILITY_REQUIRED' && /git\.commit/.test(e.message),
  );
  const once = fixture(commit, { lease: bare, oneTime: ['s1\u0000git.commit\u0000git'] });
  once.context.sessions.leaseForWorkspace = () => null;
  assert.deepEqual(await resumeApproval(once.context, 's1', 'req1'), { kind: 'git.commit' });
  const op = once.calls.find((c) => c[0] === 'worker')[1].operation;
  assert.deepEqual(op, { kind: 'git.commit', message: 'm', args: [] });
});

test('frozen process_start maps flat and nested command shapes onto the process manager', async () => {
  const started: any[] = [];
  const processes = { start: async (...args: any[]) => (started.push(args), { id: 'p1' }) };
  const flat = ticket('process_start', {
    executable: 'node',
    args: ['a.js'],
    env: { A: 'b' },
    cwdLogical: '/src',
    timeoutMs: 5,
    lifecycle: 'keep-running',
    name: 'dev',
  });
  assert.deepEqual(await resumeApproval(fixture(flat, { processes }).context, 's1', 'req1'), { id: 'p1' });
  assert.deepEqual(started[0], [
    's1',
    'w1',
    { executable: 'node', args: ['a.js'], env: { A: 'b' }, cwdLogical: '/src', timeoutMs: 5, workspaceId: 'w1' },
    'keep-running',
    'dev',
  ]);
  const nested = ticket('process_start', {
    command: { executable: 'npm', args: ['test'], env: { B: 'c' }, cwdLogical: '/pkg' },
  });
  await resumeApproval(fixture(nested, { processes }).context, 's1', 'req1');
  assert.deepEqual(started[1][2], {
    executable: 'npm',
    args: ['test'],
    env: { B: 'c' },
    cwdLogical: '/pkg',
    timeoutMs: undefined,
    workspaceId: 'w1',
  });
  assert.equal(started[1][3], 'stop-with-aevra');
  const empty = ticket('process_start', {}, { payload: { tool: 'process_start' } });
  await resumeApproval(fixture(empty, { processes }).context, 's1', 'req1');
  assert.deepEqual(started[2][2], {
    executable: '',
    args: [],
    env: {},
    cwdLogical: '/',
    timeoutMs: undefined,
    workspaceId: 'w1',
  });
});
