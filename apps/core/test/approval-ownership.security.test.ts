import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { SessionRepository } from '../../../packages/store/src/sessions.js';
import { WorkspaceRepository } from '../../../packages/store/src/workspaces.js';
import { ApprovalRepository } from '../../../packages/store/src/approvals.js';
import { AuditRepository } from '../../../packages/store/src/audit.js';
import { SessionManager } from '../src/sessions/session-manager.js';
import { WorkspaceService } from '../src/workspaces/workspace-service.js';
import { CapabilityProfileService } from '../src/policy/capabilities.js';
import { ApprovalService } from '../src/approvals/approval-service.js';
import { AuditService } from '../src/audit/audit-service.js';
import { ReadVersionCache } from '../src/operations/read-version-cache.js';
import { McpToolService } from '../../../packages/mcp-tools/src/service.js';

function fixture() {
  const db = AevraDatabase.open(':memory:');
  const workspaces = new WorkspaceService(new WorkspaceRepository(db.raw()));
  const ws1 = workspaces.create({ name: 'Workspace1', hostRoot: '/workspace/one' });
  const ws2 = workspaces.create({ name: 'Workspace2', hostRoot: '/workspace/two' });
  const sessions = new SessionManager(
    new SessionRepository(db.raw()),
    new CapabilityProfileService(db.raw()),
  );
  const approvals = new ApprovalService(
    new ApprovalRepository(db.raw()),
    new AuditService(new AuditRepository(db.raw())),
    { fastWaitMs: 0, lifetimeMs: 60_000, lifetimeByRiskMs: {} },
  );
  approvals.setSessionIdentityResolver((sessionId) => sessions.connectionIdentity(sessionId));

  const operations: any = {
    async delete(_s: string, args: any) {
      return { deleted: true, path: args.path };
    },
  };
  const tools = new McpToolService(
    sessions,
    workspaces,
    { execute: async () => ({ ok: true, value: {} }) } as any,
    new ReadVersionCache(),
    approvals,
    { operations },
  );

  return { db, workspaces, ws1, ws2, sessions, approvals, tools };
}

const oauthId = (subject = 'sub_sec_1', connectionId = 'conn_sec_1') => ({
  subject,
  actor: 'oauth:ChatGPT',
  connectionId,
  issuer: 'https://mcp.example.com',
  audience: 'https://mcp.example.com/mcp',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});

test('expired ticket rejects resume with APPROVAL_TIMEOUT', async () => {
  const f = fixture();
  const session = f.sessions.create(oauthId());
  f.sessions.grantConnectionWorkspace(session.id, f.ws1.id, 'developer');

  const req = await f.approvals.request({
    actor: session.actor,
    sessionId: session.id,
    workspaceId: f.ws1.id,
    operation: { family: 'files:delete', capability: 'files.delete', risk: 'HIGH', argsHash: 'x' },
    payload: { tool: 'file_delete', args: { path: '/tmp.txt' } },
    expectedState: {},
    risk: 'HIGH',
  });
  f.approvals.approve(req.requestId, 'once');

  const t = f.approvals.status(req.requestId)!;
  t.expiresAt = new Date(Date.now() - 1000).toISOString();
  (f.approvals as any).repo.put(t);

  const waitResult: any = await f.tools.call(session.id, 'approval_wait', {
    requestId: req.requestId,
  });
  assert.equal(waitResult.state, 'EXPIRED');

  await assert.rejects(
    () =>
      f.approvals.resume(
        req.requestId,
        async () => ({ ok: true }),
        async () => {},
      ),
    (e: any) => e.code === 'APPROVAL_TIMEOUT',
  );
  f.db.close();
});

test('downgraded capability rejects approval resumption', async () => {
  const f = fixture();
  const sessionA = f.sessions.create(oauthId('shared', 'conn_shared'));
  f.sessions.grantConnectionWorkspace(sessionA.id, f.ws1.id, 'developer');

  const req = await f.approvals.request({
    actor: sessionA.actor,
    sessionId: sessionA.id,
    workspaceId: f.ws1.id,
    operation: { family: 'files:delete', capability: 'files.delete', risk: 'HIGH', argsHash: 'x' },
    payload: { tool: 'file_delete', args: { path: '/tmp.txt' } },
    expectedState: {},
    risk: 'HIGH',
  });
  f.approvals.approve(req.requestId, 'once');

  // Downgrade connection to read-only
  const sessionB = f.sessions.create(oauthId('shared', 'conn_shared'));
  f.sessions.grantConnectionWorkspace(sessionB.id, f.ws1.id, 'read-only');

  await assert.rejects(
    () => f.tools.call(sessionB.id, 'approval_wait', { requestId: req.requestId }),
    (e: any) => e.code === 'APPROVAL_CONTEXT_CHANGED',
  );
  assert.equal(f.approvals.status(req.requestId)?.state, 'CONTEXT_CHANGED');
  f.db.close();
});

test('unauthorized caller cannot cancel approval', async () => {
  const f = fixture();
  const sessionA = f.sessions.create(oauthId('alice', 'conn_alice'));
  f.sessions.grantConnectionWorkspace(sessionA.id, f.ws1.id, 'developer');

  const req = await f.approvals.request({
    actor: sessionA.actor,
    sessionId: sessionA.id,
    workspaceId: f.ws1.id,
    operation: { family: 'files:delete', capability: 'files.delete', risk: 'HIGH', argsHash: 'x' },
    payload: { tool: 'file_delete', args: { path: '/tmp.txt' } },
    expectedState: {},
    risk: 'HIGH',
  });

  const sessionEve = f.sessions.create(oauthId('eve', 'conn_eve'));
  const cancelResult: any = await f.tools.call(sessionEve.id, 'approval_cancel', {
    requestId: req.requestId,
  });
  assert.deepEqual(cancelResult, { status: 'not_found' });

  // Ensure ticket remains PENDING
  assert.equal(f.approvals.status(req.requestId)?.state, 'PENDING');
  f.db.close();
});

test('F3: foreign connection cannot inspect tickets across all lifecycle states', async () => {
  const f = fixture();
  try {
    const sessionA = f.sessions.create(oauthId('alice_sub', 'conn_alice'));
    f.sessions.grantConnectionWorkspace(sessionA.id, f.ws1.id, 'developer');

    const sessionEve = f.sessions.create(oauthId('eve_sub', 'conn_eve'));
    f.sessions.grantConnectionWorkspace(sessionEve.id, f.ws1.id, 'developer');

    const states = [
      'PENDING',
      'APPROVED',
      'EXECUTING',
      'SUCCEEDED',
      'FAILED',
      'INTERRUPTED',
      'EXPIRED',
    ] as const;

    for (const targetState of states) {
      const req = await f.approvals.request({
        actor: sessionA.actor,
        sessionId: sessionA.id,
        workspaceId: f.ws1.id,
        operation: {
          family: 'files:delete',
          capability: 'files.delete',
          risk: 'HIGH',
          argsHash: 'x',
        },
        payload: { tool: 'file_delete', args: { path: `/secret-${targetState}.txt` } },
        expectedState: {},
        risk: 'HIGH',
      });

      const t = (f.approvals as any).repo.get(req.requestId)!;
      t.state = targetState;
      (f.approvals as any).repo.put(t);

      // Foreign session calling approval_wait gets null
      const resWait = await f.tools.call(sessionEve.id, 'approval_wait', {
        requestId: req.requestId,
      });
      assert.equal(resWait, null, `State ${targetState} should return null to foreign connection`);

      // Verify no disclosure of sensitive payload
      assert.ok(!JSON.stringify(resWait).includes(targetState));

      // Verify no state mutation
      const stored = (f.approvals as any).repo.get(req.requestId);
      assert.equal(
        stored?.state,
        targetState,
        `State ${targetState} must not be mutated by rejected caller`,
      );
    }

    // Also test legacy null-owned ticket
    const reqNull = await f.approvals.request({
      actor: sessionA.actor,
      sessionId: sessionA.id,
      workspaceId: f.ws1.id,
      operation: {
        family: 'files:delete',
        capability: 'files.delete',
        risk: 'HIGH',
        argsHash: 'x',
      },
      payload: { tool: 'file_delete', args: { path: '/secret-legacy.txt' } },
      expectedState: {},
      risk: 'HIGH',
    });
    f.db
      .raw()
      .prepare('UPDATE pending_approvals SET connection_subject=NULL WHERE id=?')
      .run(reqNull.requestId);

    const resNull = await f.tools.call(sessionEve.id, 'approval_wait', {
      requestId: reqNull.requestId,
    });
    assert.equal(resNull, null);
  } finally {
    f.db.close();
  }
});
