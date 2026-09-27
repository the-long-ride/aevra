import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { ApprovalRepository } from '../../../packages/store/src/approvals.js';
import { AuditRepository } from '../../../packages/store/src/audit.js';
import { AuditService } from '../src/audit/audit-service.js';
import { ApprovalService } from '../src/approvals/approval-service.js';

function make(wrapRepo?: (r: ApprovalRepository) => any) {
  const db = AevraDatabase.open(':memory:');
  const repo = new ApprovalRepository(db.raw());
  const svc = new ApprovalService(
    (wrapRepo ? wrapRepo(repo) : repo) as any,
    new AuditService(new AuditRepository(db.raw())),
    { fastWaitMs: 0, lifetimeMs: 300000, lifetimeByRiskMs: {} },
  );
  return { db, repo, svc };
}

let seq = 0;
function seed(repo: ApprovalRepository, state: string, extra: Record<string, unknown> = {}) {
  const id = `req_resume_${++seq}`;
  repo.put({
    id,
    actor: 'local',
    sessionId: 's',
    workspaceId: 'w',
    operation: { family: 'git:push', capability: 'git.push', risk: 'MEDIUM', argsHash: 'h' },
    expectedState: {},
    risk: 'MEDIUM',
    state,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...extra,
  });
  return id;
}

const ok = async () => ({ ok: true as const });
const fail = (reason: string) => async () => ({ ok: false as const, reason });
const never = async () => {
  throw new Error('execute must not run');
};

test('resume rejects expired, denied, and pending tickets with typed codes', async () => {
  const { db, repo, svc } = make();
  await assert.rejects(() => svc.resume(seed(repo, 'EXPIRED'), ok, never), (e: any) => e.code === 'APPROVAL_TIMEOUT');
  await assert.rejects(() => svc.resume(seed(repo, 'DENIED'), ok, never), (e: any) => e.code === 'APPROVAL_DENIED');
  await assert.rejects(
    () => svc.resume(seed(repo, 'PENDING'), ok, never),
    (e: any) => e.code === 'APPROVAL_PENDING' && /Approval is PENDING/.test(e.message),
  );
  await assert.rejects(() => svc.resume('req_absent', ok, never), /approval not found/);
  db.close();
});

test('resume returns terminal or executing tickets without running again', async () => {
  const { db, repo, svc } = make();
  for (const state of ['EXECUTING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED']) {
    const id = seed(repo, state);
    const result: any = await svc.resume(id, ok, never);
    assert.equal(result.id, id);
    assert.equal(result.state, state);
  }
  db.close();
});

test('identity-changing revalidation failures are unauthorized and keep the ticket approved', async () => {
  const { db, repo, svc } = make();
  for (const reason of ['OAuth connection changed', 'session changed', 'unauthorized']) {
    const id = seed(repo, 'APPROVED');
    await assert.rejects(
      () => svc.resume(id, fail(reason), never),
      (e: any) => e.code === 'APPROVAL_UNAUTHORIZED' && e.message === reason,
    );
    assert.equal(svc.status(id)?.state, 'APPROVED');
  }
  db.close();
});

test('context change without repository transition support leaves the state untouched', async () => {
  const { db, repo, svc } = make((r) => ({
    put: (t: any) => r.put(t),
    get: (id: string) => r.get(id),
    list: () => r.list(),
    claimExecution: (id: string, now: string) => r.claimExecution(id, now),
    transitionExecution: (id: string, s: any, now: string) => r.transitionExecution(id, s, now),
  }));
  const id = seed(repo, 'APPROVED');
  await assert.rejects(() => svc.resume(id, fail('head moved'), never), (e: any) => e.code === 'APPROVAL_CONTEXT_CHANGED');
  assert.equal(svc.status(id)?.state, 'APPROVED');
  db.close();
});

test('context change transitions the stored ticket when supported', async () => {
  const { db, repo, svc } = make();
  const id = seed(repo, 'APPROVED');
  await assert.rejects(() => svc.resume(id, fail('head moved'), never), /head moved/);
  assert.equal(svc.status(id)?.state, 'CONTEXT_CHANGED');
  db.close();
});

test('a lost execution claim returns the fresh ticket instead of executing', async () => {
  const { db, repo, svc } = make((r) => {
    const proxy = Object.create(r);
    proxy.claimExecution = () => false;
    return proxy;
  });
  const id = seed(repo, 'APPROVED');
  const result: any = await svc.resume(id, ok, never);
  assert.equal(result.id, id);
  assert.equal(result.state, 'APPROVED');
  db.close();
});

test('a failing post-claim check marks the execution failed with its reason or a default', async () => {
  const { db, repo, svc } = make();
  const withReason = seed(repo, 'APPROVED');
  await assert.rejects(
    () => svc.resume(withReason, ok, never, () => ({ ok: false, reason: 'grant revoked' })),
    (e: any) => e.code === 'APPROVAL_CONTEXT_CHANGED' && e.message === 'grant revoked',
  );
  assert.equal(svc.status(withReason)?.state, 'FAILED');
  const noReason = seed(repo, 'APPROVED');
  await assert.rejects(
    () => svc.resume(noReason, ok, never, () => ({ ok: false })),
    (e: any) => e.message === 'authority changed',
  );
  const passes = seed(repo, 'APPROVED');
  assert.equal(await svc.resume(passes, ok, async () => 'done', () => ({ ok: true })), 'done');
  assert.equal(svc.status(passes)?.state, 'SUCCEEDED');
  db.close();
});

test('an executor failure marks the ticket failed and rethrows', async () => {
  const { db, repo, svc } = make();
  const id = seed(repo, 'APPROVED');
  await assert.rejects(
    () =>
      svc.resume(id, ok, async () => {
        throw new Error('push rejected');
      }),
    /push rejected/,
  );
  assert.equal(svc.status(id)?.state, 'FAILED');
  db.close();
});
