import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { ApprovalRepository } from '../../../packages/store/src/approvals.js';
import { AuditRepository } from '../../../packages/store/src/audit.js';
import { AuditService } from '../src/audit/audit-service.js';
import { ApprovalService, type FrozenOperationTicket } from '../src/approvals/approval-service.js';

function make(
  config: Partial<{ fastWaitMs: number; lifetimeByRiskMs: any }> = {},
  wrapRepo?: (r: any) => any,
) {
  const db = AevraDatabase.open(':memory:');
  const repo = new ApprovalRepository(db.raw());
  const svc = new ApprovalService(
    (wrapRepo ? wrapRepo(repo) : repo) as any,
    new AuditService(new AuditRepository(db.raw())),
    { fastWaitMs: 0, lifetimeMs: 300000, lifetimeByRiskMs: {}, ...config },
  );
  return { db, repo, svc };
}

let seq = 0;
function seed(
  repo: ApprovalRepository,
  overrides: Partial<FrozenOperationTicket> & Record<string, unknown> = {},
) {
  const ticket = {
    id: `req_seed_${++seq}`,
    actor: 'oauth:client',
    sessionId: 'sess-1',
    workspaceId: 'w',
    operation: { family: 'git:push', capability: 'git.push', risk: 'MEDIUM', argsHash: 'h' },
    expectedState: {},
    risk: 'MEDIUM',
    state: 'PENDING',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
  repo.put(ticket);
  return ticket as FrozenOperationTicket;
}

const selectOp = {
  family: 'workspace:select',
  capability: 'workspace.select',
  risk: 'LOW',
  argsHash: 'h',
} as any;
const identity =
  (subject = 'sub-1', connectionId?: string) =>
  () => ({
    actor: 'oauth:client',
    subject,
    ...(connectionId ? { connectionId } : {}),
  });

test('workspace select requests reuse an approved or pending ticket from the same connection', async () => {
  const { db, repo, svc } = make();
  svc.setSessionIdentityResolver(identity('sub-1'));
  const approved = seed(repo, {
    operation: selectOp,
    state: 'APPROVED',
    connectionSubject: 'sub-1',
  });
  const input = {
    actor: 'oauth:client',
    sessionId: 'sess-2',
    workspaceId: 'w',
    operation: selectOp,
    expectedState: {},
    risk: 'LOW' as const,
  };
  assert.deepEqual(await svc.request(input), { status: 'approved', requestId: approved.id });
  svc.cancel(approved.id);
  const pending = seed(repo, { operation: selectOp, connectionSubject: 'sub-1' });
  const reused = await svc.request(input);
  assert.equal(reused.status, 'approval_pending');
  assert.equal(reused.requestId, pending.id);
  assert.ok((reused as any).expiresInSeconds > 0 && (reused as any).expiresInSeconds <= 60);
  db.close();
});

test('reuse matches by connection id or by the original session identity', async () => {
  const { db, repo, svc } = make();
  svc.setSessionIdentityResolver(identity('sub-9', 'conn-1'));
  const byConnection = seed(repo, { operation: selectOp, connectionId: 'conn-1' });
  const input = {
    actor: 'oauth:client',
    sessionId: 'sess-2',
    workspaceId: 'w',
    operation: selectOp,
    expectedState: {},
    risk: 'LOW' as const,
  };
  assert.equal((await svc.request(input)).requestId, byConnection.id);
  svc.deny(byConnection.id);
  const bySession = seed(repo, { operation: selectOp });
  assert.equal((await svc.request(input)).requestId, bySession.id);
  svc.deny(bySession.id);
  db.close();
});

test('host control reuse requires a pending ticket for the same identity and capability', async () => {
  const { db, repo, svc } = make();
  svc.setSessionIdentityResolver(identity('sub-1'));
  const hostOp = {
    family: 'host-control:request',
    capability: 'host.desktop',
    risk: 'HIGH',
    argsHash: 'h',
  } as any;
  const base = {
    actor: 'oauth:client',
    sessionId: 's',
    workspaceId: '',
    scope: 'host' as const,
    operation: hostOp,
    expectedState: {},
    risk: 'HIGH' as const,
  };
  seed(repo, {
    ...base,
    identity: { kind: 'app', key: 'other' },
    connectionSubject: 'sub-1',
  } as any);
  const approvedHost = seed(repo, {
    ...base,
    identity: { kind: 'app', key: 'k' },
    state: 'APPROVED',
    connectionSubject: 'sub-1',
  } as any);
  const pendingHost = seed(repo, {
    ...base,
    identity: { kind: 'app', key: 'k' },
    connectionSubject: 'sub-1',
  } as any);
  const result = await svc.request({ ...base, identity: { kind: 'app', key: 'k' } } as any);
  assert.equal(result.requestId, pendingHost.id);
  assert.notEqual(result.requestId, approvedHost.id);
  db.close();
});

test('new OAuth requests freeze connection identity, risk lifetime, and volatile payloads', async () => {
  const { db, svc } = make({ lifetimeByRiskMs: { HIGH: 1500 } });
  svc.setSessionIdentityResolver(identity('sub-1', 'conn-7'));
  const created = await svc.request({
    actor: 'oauth:client',
    sessionId: 'sess-1',
    workspaceId: 'w',
    operation: {
      family: 'files:write',
      capability: 'files.write',
      risk: 'HIGH',
      argsHash: 'h',
    } as any,
    payload: { tool: 'file_write', content: 'hello words' },
    expectedState: {},
    risk: 'HIGH',
  });
  assert.equal(created.status, 'approval_pending');
  assert.ok((created as any).expiresInSeconds <= 2);
  const stored = svc.status(created.requestId)!;
  assert.equal(stored.connectionId, 'conn-7');
  assert.deepEqual(stored.payload, { tool: 'file_write', content: '[REDACTED]' });
  svc.approve(created.requestId);
  let seen: unknown;
  await svc.resume(
    created.requestId,
    async () => ({ ok: true }),
    async (t) => (seen = t.payload),
  );
  assert.deepEqual(
    seen,
    { tool: 'file_write', content: 'hello words' },
    'executor receives unredacted payload',
  );
  assert.equal(svc.status(created.requestId)?.state, 'SUCCEEDED');
  db.close();
});

test('explicit volatile payload and fast-wait approval are honored', async () => {
  const { db, svc } = make({ fastWaitMs: 1000 });
  const pending = svc.request(
    {
      actor: 'local',
      sessionId: 's',
      workspaceId: 'w',
      operation: {
        family: 'git:push',
        capability: 'git.push',
        risk: 'MEDIUM',
        argsHash: 'h',
      } as any,
      expectedState: {},
      risk: 'MEDIUM',
    },
    { note: 'volatile words' },
  );
  await new Promise((resolve) => setImmediate(resolve));
  const [ticket] = svc.list();
  assert.equal(ticket.connectionId, undefined, 'non-OAuth actors are not bound to a connection');
  assert.equal(typeof ticket.presentation, 'object');
  svc.approve(ticket.id);
  assert.deepEqual(await pending, { status: 'approved', requestId: ticket.id });
  let seen: unknown;
  await svc.resume(
    ticket.id,
    async () => ({ ok: true }),
    async (t) => (seen = t.payload),
  );
  assert.deepEqual(seen, { note: 'volatile words' });
  db.close();
});

test('status expires stale tickets and hides tickets from other callers', () => {
  const { db, repo, svc } = make();
  const stale = seed(repo, { expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(svc.status(stale.id)?.state, 'EXPIRED');
  assert.equal(svc.status('req_missing'), null);
  const bound = seed(repo, { connectionSubject: 'sub-1' });
  assert.equal(svc.status(bound.id, { actor: 'oauth:other', sessionId: 'sess-1' }), null);
  assert.equal(
    svc.status(bound.id, { actor: 'oauth:client', sessionId: 'x', subject: 'sub-1' })?.id,
    bound.id,
  );
  assert.equal(
    svc.status(bound.id, { actor: 'oauth:client', sessionId: 'sess-1', subject: 'sub-2' }),
    null,
  );
  const byConn = seed(repo, { connectionId: 'conn-2' });
  assert.equal(
    svc.status(byConn.id, { actor: 'oauth:client', sessionId: 'x', connectionId: 'conn-2' })?.id,
    byConn.id,
  );
  const local = seed(repo, { actor: 'local' });
  assert.equal(svc.status(local.id, { actor: 'local', sessionId: 'sess-1' })?.id, local.id);
  assert.equal(svc.status(local.id, { actor: 'local', sessionId: 'sess-2' }), null);
  db.close();
});

test('approve enforces scope rules for host, shell, high-risk, and session-scoped requests', () => {
  const { db, repo, svc } = make();
  const reject = (overrides: Record<string, unknown>, scope: string, pattern: RegExp) => {
    const t = seed(repo, overrides as any);
    assert.throws(() => svc.approve(t.id, scope), pattern);
    assert.equal(svc.status(t.id)?.state, 'PENDING');
  };
  const host = { scope: 'host', identity: { kind: 'app', key: 'k' } };
  reject(
    {
      ...host,
      operation: { family: 'host-control:request', capability: 'host.desktop', risk: 'HIGH' },
    },
    'once',
    /requires connection scope/,
  );
  reject(
    { ...host, operation: { family: 'desktop:click', capability: 'host.desktop', risk: 'HIGH' } },
    'connection',
    /requires once scope/,
  );
  reject(
    { operation: { family: 'shell:pwsh', capability: 'commands.run', risk: 'MEDIUM' } },
    'session',
    /Shell execution only supports/,
  );
  reject(
    { operation: { family: 'rm', capability: 'commands.run', risk: 'HIGH' } },
    'session',
    /High-risk commands only support/,
  );
  reject(
    { operation: { family: 'skills:read', capability: 'skills.read', risk: 'LOW' } },
    'session',
    /only supports one-time/,
  );
  const lowCommand = seed(repo, {
    operation: { family: 'git', capability: 'commands.run', risk: 'LOW' } as any,
  });
  assert.equal(svc.approve(lowCommand.id, 'session').decisionScope, 'session');
  assert.throws(() => svc.approve(lowCommand.id), /Cannot approve APPROVED/);
  assert.throws(() => svc.approve('req_missing'), /approval not found/);
  db.close();
});

test('connector workspace select approvals are downgraded to read-only and handlers run in order', () => {
  const { db, repo, svc } = make();
  const order: string[] = [];
  svc.addBeforeApprovedHandler(() => order.push('before'));
  svc.addApprovedHandler(() => order.push('replaced'));
  svc.setApprovedHandler((t) => order.push(`after:${t.decisionScope}`));
  const t = seed(repo, {
    actor: 'connector:web',
    operation: selectOp,
    payload: { tool: 'workspace_select', profileId: 'developer' },
  });
  const approved = svc.approve(t.id, 'connection');
  assert.deepEqual(approved.payload, { tool: 'workspace_select', profileId: 'read-only' });
  assert.deepEqual(order, ['before', 'after:connection']);
  const other = seed(repo, {
    actor: 'connector:web',
    operation: selectOp,
    payload: { tool: 'workspace_select', profileId: 'reviewer' },
  });
  assert.deepEqual(svc.approve(other.id).payload, {
    tool: 'workspace_select',
    profileId: 'reviewer',
  });
  svc.setApprovedHandler(() => {
    throw new Error('grant failed');
  });
  const failing = seed(repo);
  assert.throws(() => svc.approve(failing.id), /grant failed/);
  assert.equal(
    svc.status(failing.id)?.state,
    'PENDING',
    'failed side effects keep the ticket pending',
  );
  db.close();
});

test('deny, cancel, and restart cancellation transition ticket states', () => {
  const { db, repo, svc } = make();
  const t = seed(repo);
  assert.equal(svc.deny(t.id).state, 'DENIED');
  assert.throws(() => svc.deny(t.id), /Cannot deny DENIED/);
  assert.throws(() => svc.cancel(t.id), /Cannot cancel DENIED/);
  const owned = seed(repo, { actor: 'local' });
  assert.throws(
    () => svc.cancel(owned.id, 'x', { actor: 'local', sessionId: 'other' }),
    (e: any) => e.code === 'APPROVAL_NOT_FOUND',
  );
  assert.equal(
    svc.cancel(owned.id, 'user', { actor: 'local', sessionId: 'sess-1' }).cancellationReason,
    'user',
  );
  const pending = seed(repo);
  const executing = seed(repo, { state: 'EXECUTING' });
  const done = seed(repo, { state: 'SUCCEEDED' });
  svc.cancelForRestart();
  assert.equal(svc.status(pending.id)?.cancellationReason, 'CANCELLED_RESTART');
  assert.equal(svc.status(executing.id)?.state, 'INTERRUPTED');
  assert.equal(svc.status(done.id)?.state, 'SUCCEEDED');
  db.close();
});
