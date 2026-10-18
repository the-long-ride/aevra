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
  const dir = mkdtempSync(join(tmpdir(), 'aevra-rot-'));
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

  const operations: any = {
    async delete(_s: string, args: { path: string }) {
      return { deleted: true, path: args.path };
    },
  };

  const worker: any = {
    async execute(input: any) {
      if (input.operation.kind === 'file.list') {
        return {
          ok: true,
          value: { path: input.operation.path, entries: [{ name: 'README.md', type: 'file' }] },
        };
      }
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
    cleanup: () => {
      try {
        db.close();
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    },
  };
}

const oauthIdentity = (subject = 'sub_rot_1', connectionId = 'conn_rot_1') => ({
  subject,
  actor: 'oauth:Gemini',
  connectionId,
  issuer: 'https://mcp.example.com',
  audience: 'https://mcp.example.com/mcp',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});

test('connection-scoped grant exists: B first workspace_current and file_list with explicit workspace works via lazy restore', async () => {
  const f = fixture();
  try {
    const sessionA = f.sessions.create(oauthIdentity('sub_rot_1', 'conn_rot_1'));
    f.sessions.grantConnectionWorkspace(sessionA.id, f.ws1.id, 'developer');

    const sessionB = f.sessions.create(oauthIdentity('sub_rot_1', 'conn_rot_1'));

    const listResult = (await f.tools.call(sessionB.id, 'file_list', {
      path: '/',
      workspace: 'Workspace1',
    })) as any;
    assert.deepEqual(listResult, { path: '/', entries: [{ name: 'README.md', type: 'file' }] });

    const current = (await f.tools.call(sessionB.id, 'workspace_current')) as any;
    assert.equal(current.id, f.ws1.id);
  } finally {
    f.cleanup();
  }
});

test('grant revoked between A and B: B fails closed with WORKSPACE_ACCESS_REQUIRED', async () => {
  const f = fixture();
  try {
    const sessionA = f.sessions.create(oauthIdentity('sub_rot_2', 'conn_rot_2'));
    f.sessions.grantConnectionWorkspace(sessionA.id, f.ws1.id, 'developer');

    f.sessions.revokeWorkspace(sessionA.id, f.ws1.id);

    const sessionB = f.sessions.create(oauthIdentity('sub_rot_2', 'conn_rot_2'));
    await assert.rejects(
      () => f.tools.call(sessionB.id, 'file_list', { path: '/', workspace: 'Workspace1' }),
      (e: any) => e.code === 'WORKSPACE_ACCESS_REQUIRED',
    );
  } finally {
    f.cleanup();
  }
});

test('grant for workspace X only: B targeting Y fails closed with WORKSPACE_ACCESS_REQUIRED', async () => {
  const f = fixture();
  try {
    const sessionA = f.sessions.create(oauthIdentity('sub_rot_3', 'conn_rot_3'));
    f.sessions.grantConnectionWorkspace(sessionA.id, f.ws1.id, 'developer');

    const sessionB = f.sessions.create(oauthIdentity('sub_rot_3', 'conn_rot_3'));
    await assert.rejects(
      () => f.tools.call(sessionB.id, 'file_list', { path: '/', workspace: 'Workspace2' }),
      (e: any) => e.code === 'WORKSPACE_ACCESS_REQUIRED',
    );
  } finally {
    f.cleanup();
  }
});

test('two granted workspaces without explicit target fails closed with WORKSPACE_REQUIRED', async () => {
  const f = fixture();
  try {
    const sessionA = f.sessions.create(oauthIdentity('sub_rot_4', 'conn_rot_4'));
    f.sessions.grantConnectionWorkspace(sessionA.id, f.ws1.id, 'developer');
    f.sessions.grantConnectionWorkspace(sessionA.id, f.ws2.id, 'developer');

    const sessionB = f.sessions.create(oauthIdentity('sub_rot_4', 'conn_rot_4'));
    await assert.rejects(
      () => f.tools.call(sessionB.id, 'file_list', { path: '/' }),
      (e: any) => e.code === 'WORKSPACE_REQUIRED' || e.code === 'SESSION_WORKSPACE_REQUIRED',
    );
  } finally {
    f.cleanup();
  }
});

test('different subject, same actor: nothing shared', async () => {
  const f = fixture();
  try {
    const sessionA = f.sessions.create(oauthIdentity('subject_alpha', 'conn_alpha'));
    f.sessions.grantConnectionWorkspace(sessionA.id, f.ws1.id, 'developer');

    const sessionOther = f.sessions.create(oauthIdentity('subject_beta', 'conn_beta'));
    assert.deepEqual(await f.tools.call(sessionOther.id, 'workspace_current'), {
      status: 'none',
      workspace: null,
    });
    await assert.rejects(
      () => f.tools.call(sessionOther.id, 'file_list', { path: '/', workspace: 'Workspace1' }),
      (e: any) => e.code === 'WORKSPACE_ACCESS_REQUIRED',
    );
  } finally {
    f.cleanup();
  }
});

test('workspace_select ticket approved once gives APPROVAL_SCOPE_MISMATCH to rotating session B', async () => {
  const f = fixture();
  try {
    const sessionA = f.sessions.create(oauthIdentity('sub_rot_6b', 'conn_rot_6b'));

    const req = await f.approvals.request({
      actor: sessionA.actor,
      sessionId: sessionA.id,
      workspaceId: f.ws1.id,
      operation: {
        family: 'workspace:select',
        capability: 'files.read',
        risk: 'LOW',
        argsHash: 'h_select',
      },
      payload: {
        tool: 'workspace_select',
        workspaceId: f.ws1.id,
      },
      expectedState: {},
      risk: 'LOW',
    });

    f.approvals.approve(req.requestId, 'once');

    const sessionB = f.sessions.create(oauthIdentity('sub_rot_6b', 'conn_rot_6b'));

    await assert.rejects(
      () => f.tools.call(sessionB.id, 'approval_wait', { requestId: req.requestId }),
      (e: any) => e.code === 'APPROVAL_SCOPE_MISMATCH',
    );
  } finally {
    f.cleanup();
  }
});

test('capability ticket approved once is resumable across sessions on same connection', async () => {
  const f = fixture();
  try {
    const sessionA = f.sessions.create(oauthIdentity('sub_rot_6c', 'conn_rot_6c'));
    f.sessions.grantConnectionWorkspace(sessionA.id, f.ws1.id, 'developer');

    const req = await f.approvals.request({
      actor: sessionA.actor,
      sessionId: sessionA.id,
      workspaceId: f.ws1.id,
      operation: {
        family: 'files:delete',
        capability: 'files.delete',
        risk: 'HIGH',
        argsHash: 'h_cap_once',
      },
      payload: {
        tool: 'capability_request',
        permissionMatcher: '*',
        original: { tool: 'file_delete', args: { path: '/delete-once.txt' } },
      },
      expectedState: {},
      risk: 'HIGH',
    });

    f.approvals.approve(req.requestId, 'once');

    const sessionB = f.sessions.create(oauthIdentity('sub_rot_6c', 'conn_rot_6c'));
    f.sessions.grantConnectionWorkspace(sessionB.id, f.ws1.id, 'developer');

    const resumed: any = await f.tools.call(sessionB.id, 'approval_wait', {
      requestId: req.requestId,
    });
    assert.deepEqual(resumed, { deleted: true, path: '/delete-once.txt' });
  } finally {
    f.cleanup();
  }
});

test('parallel restore of the same connection grant produces one lease per session without duplicate rows', async () => {
  const f = fixture();
  try {
    const sessionA = f.sessions.create(oauthIdentity('sub_rot_7', 'conn_rot_7'));
    f.sessions.grantConnectionWorkspace(sessionA.id, f.ws1.id, 'developer');

    const sessionB = f.sessions.create(oauthIdentity('sub_rot_7', 'conn_rot_7'));

    await Promise.all([
      f.tools.call(sessionA.id, 'file_list', { path: '/', workspace: 'Workspace1' }),
      f.tools.call(sessionB.id, 'file_list', { path: '/', workspace: 'Workspace1' }),
    ]);

    assert.equal(f.sessions.leases(sessionA.id).length, 1);
    assert.equal(f.sessions.leases(sessionB.id).length, 1);

    const rows = f.db
      .raw()
      .prepare(
        'SELECT COUNT(*) as cnt FROM oauth_workspace_grants WHERE subject = ? AND workspace_id = ?',
      )
      .get('sub_rot_7', f.ws1.id) as { cnt: number };
    assert.equal(rows.cnt, 1);
  } finally {
    f.cleanup();
  }
});

test('modern transport resolves multiple calls from same connection to a single internal session', () => {
  const f = fixture();
  try {
    const id = oauthIdentity('modern_sub', 'modern_conn');
    const first = f.sessions.getOrCreateForIdentity(id);
    const second = f.sessions.getOrCreateForIdentity(id);
    assert.equal(first.session.id, second.session.id);
    assert.equal(second.mode, 'existing');
  } finally {
    f.cleanup();
  }
});
