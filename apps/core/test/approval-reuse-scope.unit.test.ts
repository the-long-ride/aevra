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
test('host control reuse ignores the arguments of the call that triggered the request', async () => {
  const { db, repo, svc } = make();
  svc.setSessionIdentityResolver(identity('sub-1'));
  const base = {
    actor: 'oauth:client',
    sessionId: 's',
    workspaceId: '',
    scope: 'host' as const,
    identity: { kind: 'app', key: 'k' },
    expectedState: {},
    risk: 'HIGH' as const,
  };
  const hostOp = (argsHash: string) =>
    ({
      family: 'host-control:request',
      capability: 'host.desktop',
      risk: 'HIGH',
      argsHash,
    }) as any;
  const pending = seed(repo, {
    ...base,
    operation: hostOp('first-call'),
    connectionSubject: 'sub-1',
  } as any);
  const result = await svc.request({ ...base, operation: hostOp('second-call') } as any);
  assert.equal(result.requestId, pending.id);
  db.close();
});

test('list computes the rotation hint only for pending workspace admissions', () => {
  const { db, repo, svc } = make();
  const asked: string[] = [];
  svc.setMultipleSessionsResolver((ticket) => {
    asked.push(ticket.id);
    return true;
  });
  const pending = seed(repo, { operation: selectOp, connectionId: 'c1', sessionId: 'a' } as any);
  const decided = seed(repo, {
    operation: selectOp,
    state: 'DENIED',
    connectionId: 'c1',
    sessionId: 'b',
  } as any);
  const capability = seed(repo, { connectionId: 'c1', sessionId: 'c' } as any);
  const byId = new Map(svc.list().map((item: any) => [item.id, item.presentation]));
  assert.equal(byId.get(pending.id)?.connectionHasMultipleSessions, true);
  assert.equal(byId.get(decided.id)?.connectionHasMultipleSessions, undefined);
  assert.equal(byId.get(capability.id)?.connectionHasMultipleSessions, undefined);
  assert.deepEqual(asked, [pending.id]);
  db.close();
});
