import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  const dir = mkdtempSync(join(tmpdir(), 'aevra-appr-share-'));
  const db = AevraDatabase.open(':memory:');
  const workspaces = new WorkspaceService(new WorkspaceRepository(db.raw()));
  const ws1 = workspaces.create({ name: 'Workspace1', hostRoot: dir });
  const ws2 = workspaces.create({ name: 'Workspace2', hostRoot: join(dir, 'ws2') });
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

  let deleteCalls = 0;
  const deletedFiles: string[] = [];
  const operations: any = {
    async delete(_sessionId: string, args: { path: string }, _auth: any) {
      deleteCalls++;
      deletedFiles.push(args.path);
      const fullPath = join(dir, args.path.replace(/^\//, ''));
      if (existsSync(fullPath)) rmSync(fullPath, { force: true });
      return { deleted: true, path: args.path };
    },
  };

  const worker: any = {
    async execute(input: any) {
      if (input.operation.kind === 'git.commit') return { ok: true, value: { committed: true } };
      return { ok: true, value: {} };
    },
  };

  const tools = new McpToolService(
    sessions,
    workspaces,
    worker,
    new ReadVersionCache(),
    approvals,
    { operations },
  );

  return {
    dir,
    db,
    workspaces,
    ws1,
    ws2,
    sessions,
    approvals,
    tools,
    getDeleteCalls: () => deleteCalls,
    cleanup: () => {
      try {
        db.close();
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    },
  };
}

const oauthIdentity = (subject = 'sub_conn_1', connectionId = 'conn_1') => ({
  subject,
  actor: 'oauth:ChatGPT',
  connectionId,
  issuer: 'https://mcp.example.com',
  audience: 'https://mcp.example.com/mcp',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});

test('VM A requests file deletion, operator approves, VM B resumes approval after A is deleted', async () => {
  const f = fixture();
  try {
    const filePath = join(f.dir, 'test-target.txt');
    writeFileSync(filePath, 'hello world');
    assert.equal(existsSync(filePath), true);

    const sessionA = f.sessions.create(oauthIdentity('shared_subject', 'conn_shared'));
    f.sessions.grantConnectionWorkspace(sessionA.id, f.ws1.id, 'developer');

    const reqResult = (await f.tools.call(sessionA.id, 'file_delete', {
      path: '/test-target.txt',
      workspaceId: f.ws1.id,
    })) as any;

    let requestId: string;
    if (reqResult.status === 'approval_pending') {
      requestId = reqResult.requestId;
    } else {
      const ticket = (await f.approvals.request({
        actor: sessionA.actor,
        sessionId: sessionA.id,
        workspaceId: f.ws1.id,
        operation: {
          family: 'files:delete',
          capability: 'files.delete',
          risk: 'HIGH',
          argsHash: 'x',
        },
        payload: { tool: 'file_delete', args: { path: '/test-target.txt' } },
        expectedState: {},
        risk: 'HIGH',
      })) as any;
      requestId = ticket.requestId;
    }

    f.approvals.approve(requestId, 'once');

    (f.sessions as any).sessions.delete(sessionA.id);
    assert.equal(f.sessions.get(sessionA.id), null);

    const sessionB = f.sessions.create(oauthIdentity('shared_subject', 'conn_shared'));
    f.sessions.grantConnectionWorkspace(sessionB.id, f.ws1.id, 'developer');

    const resumed: any = await f.tools.call(sessionB.id, 'approval_wait', { requestId });
    assert.deepEqual(resumed, { deleted: true, path: '/test-target.txt' });
    assert.equal(f.getDeleteCalls(), 1);
    assert.equal(existsSync(filePath), false);

    const reResume: any = await f.tools.call(sessionB.id, 'approval_wait', { requestId });
    assert.equal(reResume.state, 'SUCCEEDED');
    assert.equal(f.getDeleteCalls(), 1);
  } finally {
    f.cleanup();
  }
});

test('foreign connection and same actor different subject cannot resume or poison approval', async () => {
  const f = fixture();
  try {
    const sessionA = f.sessions.create(oauthIdentity('subject_alpha', 'conn_alpha'));
    f.sessions.grantConnectionWorkspace(sessionA.id, f.ws1.id, 'developer');

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
      payload: { tool: 'file_delete', args: { path: '/other.txt' } },
      expectedState: {},
      risk: 'HIGH',
    });
    f.approvals.approve(req.requestId, 'once');

    const foreignSession = f.sessions.create(oauthIdentity('subject_beta', 'conn_beta'));
    f.sessions.grantConnectionWorkspace(foreignSession.id, f.ws1.id, 'developer');

    const foreignStatus: any = await f.tools.call(foreignSession.id, 'approval_status', {
      requestId: req.requestId,
    });
    assert.deepEqual(foreignStatus, { status: 'not_found' });

    const foreignResume: any = await f.tools.call(foreignSession.id, 'approval_wait', {
      requestId: req.requestId,
    });
    assert.equal(foreignResume, null);

    const originalTicket = f.approvals.status(req.requestId);
    assert.equal(originalTicket?.state, 'APPROVED');
  } finally {
    f.cleanup();
  }
});

test('legacy null-owned ticket cannot be resumed by another session', async () => {
  const f = fixture();
  try {
    const sessionA = f.sessions.create(oauthIdentity('sub', 'conn'));
    f.sessions.grantConnectionWorkspace(sessionA.id, f.ws1.id, 'developer');

    const req = await f.approvals.request({
      actor: sessionA.actor,
      sessionId: sessionA.id,
      connectionId: undefined,
      connectionSubject: undefined,
      workspaceId: f.ws1.id,
      operation: {
        family: 'files:delete',
        capability: 'files.delete',
        risk: 'HIGH',
        argsHash: 'x',
      },
      payload: { tool: 'file_delete', args: { path: '/other.txt' } },
      expectedState: {},
      risk: 'HIGH',
    });
    f.approvals.approve(req.requestId, 'once');
    f.db
      .raw()
      .prepare('UPDATE pending_approvals SET connection_subject=NULL WHERE id=?')
      .run(req.requestId);

    const sessionB = f.sessions.create(oauthIdentity('sub', 'conn'));
    f.sessions.grantConnectionWorkspace(sessionB.id, f.ws1.id, 'developer');

    const resumeResult: any = await f.tools.call(sessionB.id, 'approval_wait', {
      requestId: req.requestId,
    });
    assert.equal(resumeResult, null);
  } finally {
    f.cleanup();
  }
});

test('F6: runtime approval callback only creates durable grant for connection scope', async () => {
  const f = fixture();
  try {
    f.approvals.setApprovedHandler((ticket) => {
      if (ticket.operation.family === 'workspace:select' && ticket.decisionScope === 'connection') {
        const profileId = String((ticket.payload as any)?.profileId ?? 'read-only');
        f.sessions.grantConnectionWorkspace(ticket.sessionId, ticket.workspaceId, profileId);
      }
    });

    const sessionA = f.sessions.create(oauthIdentity('sub_scope_test', 'conn_scope_test'));

    // 1. Approve once -> does NOT create durable connection grant
    const reqOnce = await f.approvals.request({
      actor: sessionA.actor,
      sessionId: sessionA.id,
      workspaceId: f.ws1.id,
      operation: {
        family: 'workspace:select',
        capability: 'files.read',
        risk: 'HIGH',
        argsHash: 'hash1',
      },
      payload: { tool: 'workspace_select', profileId: 'developer' },
      expectedState: {},
      risk: 'HIGH',
    });
    f.approvals.approve(reqOnce.requestId, 'once');

    // Create runner session B under the same connection
    const sessionB = f.sessions.create(oauthIdentity('sub_scope_test', 'conn_scope_test'));
    const leasesB = f.sessions.leases(sessionB.id);
    assert.deepEqual(leasesB, [], 'session once approval must not create durable connection grant');

    // 2. Approve with connection scope -> DOES create durable connection grant with approved profile
    const reqConn = await f.approvals.request({
      actor: sessionA.actor,
      sessionId: sessionA.id,
      workspaceId: f.ws2.id,
      operation: {
        family: 'workspace:select',
        capability: 'files.read',
        risk: 'HIGH',
        argsHash: 'hash2',
      },
      payload: { tool: 'workspace_select', profileId: 'developer' },
      expectedState: {},
      risk: 'HIGH',
    });
    f.approvals.approve(reqConn.requestId, 'connection');

    // Create runner session C under the same connection
    const sessionC = f.sessions.create(oauthIdentity('sub_scope_test', 'conn_scope_test'));
    const leasesC = f.sessions.leases(sessionC.id);
    assert.equal(leasesC.length, 1);
    assert.equal(leasesC[0]!.workspaceId, f.ws2.id);
    assert.ok(
      leasesC[0]!.capabilities.includes('files.write'),
      'Connection-scoped approval must grant developer capabilities',
    );
  } finally {
    f.cleanup();
  }
});
