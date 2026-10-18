import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { ApprovalRepository } from '../../../packages/store/src/approvals.js';
import { AuditRepository } from '../../../packages/store/src/audit.js';
import { AuditService } from '../src/audit/audit-service.js';
import { ApprovalService } from '../src/approvals/approval-service.js';
import { handleApprovalPermissionRoutes } from '../src/admin/routes/approval-permission-routes.js';

function make(lifetimeMs = 300000) {
  const db = AevraDatabase.open(':memory:');
  const svc = new ApprovalService(
    new ApprovalRepository(db.raw()),
    new AuditService(new AuditRepository(db.raw())),
    { fastWaitMs: 0, lifetimeMs, lifetimeByRiskMs: {} },
  );
  return { db, svc };
}

function input(family: string) {
  return {
    actor: 'a',
    sessionId: 's',
    workspaceId: 'w',
    operation: {
      family,
      capability: 'git.push' as const,
      risk: 'MEDIUM' as const,
      argsHash: family,
    },
    expectedState: {},
    risk: 'MEDIUM' as const,
  };
}

function request(method: string) {
  const stream = Readable.from([]) as any;
  stream.method = method;
  stream.headers = {};
  return stream;
}

function response() {
  const res = {
    statusCode: 0,
    body: '',
    setHeader() {},
    end(v = '') {
      res.body = String(v);
    },
  };
  return res as any;
}

test('service clearHistory removes finished tickets and keeps pending and approved', async () => {
  const { db, svc } = make();
  const pending = await svc.request(input('p'));
  const approved = await svc.request(input('a'));
  const denied = await svc.request(input('d'));
  const cancelled = await svc.request(input('c'));
  svc.approve(approved.requestId, 'once');
  svc.deny(denied.requestId);
  svc.cancel(cancelled.requestId);

  assert.equal(svc.clearHistory(), 2);
  const ids = svc.list().map((row: any) => row.id);
  assert.deepEqual(ids.sort(), [pending.requestId, approved.requestId].sort());
  db.close();
});

test('service clearHistory also clears pending tickets that already expired', async () => {
  const { db, svc } = make(1);
  await svc.request(input('x'));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(svc.clearHistory(), 1);
  assert.equal(svc.list().length, 0);
  db.close();
});

test('DELETE /api/approvals/history returns the count and appends an audit event', async () => {
  const events: any[] = [];
  const context = {
    approvals: { clearHistory: () => 3 },
    audit: { append: (event: any) => events.push(event) },
  } as any;
  const res = response();
  const handled = await handleApprovalPermissionRoutes(
    request('DELETE'),
    res,
    new URL('https://localhost/api/approvals/history'),
    context,
  );
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { deleted: 3 });
  assert.equal(events.length, 1);
  assert.equal(events[0].operation, 'approval.history.clear');
  assert.equal(events[0].actor, 'admin');
  assert.equal(events[0].target, '3');
  assert.equal(events[0].class, 'normal');
});

test('/api/approvals/history rejects non-DELETE methods', async () => {
  const context = { approvals: { clearHistory: () => 1 }, audit: { append() {} } } as any;
  for (const method of ['GET', 'POST', 'PUT']) {
    const res = response();
    const handled = await handleApprovalPermissionRoutes(
      request(method),
      res,
      new URL('https://localhost/api/approvals/history'),
      context,
    );
    assert.equal(handled === true && res.statusCode === 200, false, method);
  }
});
