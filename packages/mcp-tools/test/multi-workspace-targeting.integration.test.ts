import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AevraDatabase } from '../../store/src/database.js';
import { WorkspaceRepository } from '../../store/src/workspaces.js';
import { SessionRepository } from '../../store/src/sessions.js';
import { ApprovalRepository } from '../../store/src/approvals.js';
import { AuditRepository } from '../../store/src/audit.js';
import { WorkspaceService } from '../../../apps/core/src/workspaces/workspace-service.js';
import { CapabilityProfileService } from '../../../apps/core/src/policy/capabilities.js';
import { SessionManager } from '../../../apps/core/src/sessions/session-manager.js';
import { ReadVersionCache } from '../../../apps/core/src/operations/read-version-cache.js';
import { ApprovalService } from '../../../apps/core/src/approvals/approval-service.js';
import { AuditService } from '../../../apps/core/src/audit/audit-service.js';
import { McpToolService } from '../src/service.js';
import { fileRead } from '../../executor/src/files.js';

function setupMultiWorkspace() {
  const db = AevraDatabase.open(':memory:');
  const workspaces = new WorkspaceService(new WorkspaceRepository(db.raw()));
  const rootA = mkdtempSync(path.join(os.tmpdir(), 'aevra-mws-a-'));
  const rootB = mkdtempSync(path.join(os.tmpdir(), 'aevra-mws-b-'));
  const wA = workspaces.create({ name: 'Aevra', hostRoot: rootA });
  const wB = workspaces.create({ name: 'Quotashift', hostRoot: rootB });

  writeFileSync(path.join(rootA, 'a.txt'), 'content-from-aevra');
  writeFileSync(path.join(rootB, 'b.txt'), 'content-from-quotashift');

  const profiles = new CapabilityProfileService(db.raw());
  const sessions = new SessionManager(new SessionRepository(db.raw()), profiles);
  const approvals = new ApprovalService(
    new ApprovalRepository(db.raw()),
    new AuditService(new AuditRepository(db.raw())),
    { fastWaitMs: 0, lifetimeMs: 60_000, lifetimeByRiskMs: {} },
  );
  approvals.setSessionIdentityResolver((id) => sessions.connectionIdentity(id));

  const executedCommands: any[] = [];
  const operations: any = {
    write: async (sessionId: string, input: any, authorization: any) => {
      const targetDir = authorization.workspaceId === wA.id ? rootA : rootB;
      writeFileSync(path.join(targetDir, input.path.replace(/^\//, '')), input.content);
      return { path: input.path, hash: 'sha256:written' };
    },
    runCommand: async (sessionId: string, workspaceIdOrCommand: any, commandOrMode?: any) => {
      const workspaceId =
        typeof workspaceIdOrCommand === 'string'
          ? workspaceIdOrCommand
          : workspaceIdOrCommand?.workspaceId;
      const cmd = typeof workspaceIdOrCommand === 'string' ? commandOrMode : workspaceIdOrCommand;
      executedCommands.push({ sessionId, workspaceId, cmd });
      return { exitCode: 0, signal: null, stdout: 'ok', stderr: '', durationMs: 1 };
    },
  };

  const processRecords = new Map<string, any>();
  const processes: any = {
    start: async (sessionId: string, workspaceIdOrCommand: any, maybeCmd?: any) => {
      const workspaceId =
        typeof workspaceIdOrCommand === 'string'
          ? workspaceIdOrCommand
          : workspaceIdOrCommand?.workspaceId;
      const pid = 'proc_' + Math.random().toString(36).slice(2);
      processRecords.set(pid, { processId: pid, workspace_id: workspaceId });
      return { processId: pid, state: 'running' };
    },
    status: async (sessionId: string, processId: string, workspaceId?: string) => {
      const rec = processRecords.get(processId);
      if (!rec) return { ok: false, error: { code: 'NOT_FOUND', message: 'Process not found' } };
      if (workspaceId && rec.workspace_id !== workspaceId) {
        return { ok: false, error: { code: 'NOT_FOUND', message: 'Process not found' } };
      }
      const lease = sessions.leaseForWorkspace(sessionId, rec.workspace_id);
      if (!lease)
        return { ok: false, error: { code: 'SESSION_WORKSPACE_REQUIRED', message: 'No lease' } };
      return { ok: true, value: { processId, state: 'running' } };
    },
    command: async (
      sessionId: string,
      kind: string,
      processId: string,
      cursor?: string,
      workspaceId?: string,
    ) => {
      const rec = processRecords.get(processId);
      if (!rec) return { ok: false, error: { code: 'NOT_FOUND', message: 'Process not found' } };
      if (workspaceId && rec.workspace_id !== workspaceId) {
        return { ok: false, error: { code: 'NOT_FOUND', message: 'Process not found' } };
      }
      const lease = sessions.leaseForWorkspace(sessionId, rec.workspace_id);
      if (!lease)
        return { ok: false, error: { code: 'SESSION_WORKSPACE_REQUIRED', message: 'No lease' } };
      return { ok: true, value: { processId, state: 'stopped' } };
    },
  };

  const service = new McpToolService(
    sessions,
    workspaces,
    {
      execute: async (i: any) => {
        const o = i.operation;
        if (o.kind === 'file.read') {
          return { ok: true, value: await fileRead(o.path, i.roots) };
        }
        return { ok: true, value: {} };
      },
    } as any,
    new ReadVersionCache(),
    approvals,
    { approvals, operations, processes },
  );

  const session = sessions.create({
    actor: 'oauth:ChatGPT',
    subject: 'conn-chatgpt',
    issuer: 'https://example.test',
    audience: 'https://example.test/mcp',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });

  return {
    db,
    workspaces,
    rootA,
    rootB,
    wA,
    wB,
    profiles,
    sessions,
    session,
    approvals,
    service,
    executedCommands,
    processRecords,
  };
}

test('1. Multiple workspaces coexist (activeLease null, leases.length === 2)', () => {
  const fx = setupMultiWorkspace();
  fx.sessions.grantConnectionWorkspace(fx.session.id, fx.wA.id, 'developer');
  fx.sessions.grantConnectionWorkspace(fx.session.id, fx.wB.id, 'developer');

  assert.equal(fx.sessions.activeLease(fx.session.id), null);
  const leases = fx.sessions.leases(fx.session.id);
  assert.equal(leases.length, 2);
  assert.ok(fx.sessions.leaseForWorkspace(fx.session.id, fx.wA.id));
  assert.ok(fx.sessions.leaseForWorkspace(fx.session.id, fx.wB.id));
  fx.db.close();
});

test('2. Explicit reads work independently across multiple workspaces', async () => {
  const fx = setupMultiWorkspace();
  fx.sessions.grantConnectionWorkspace(fx.session.id, fx.wA.id, 'developer');
  fx.sessions.grantConnectionWorkspace(fx.session.id, fx.wB.id, 'developer');

  const readA = (await fx.service.call(fx.session.id, 'file_read', {
    workspace: 'Aevra',
    path: '/a.txt',
  })) as any;
  assert.equal(readA.content, 'content-from-aevra');

  const readB = (await fx.service.call(fx.session.id, 'file_read', {
    workspace: 'Quotashift',
    path: '/b.txt',
  })) as any;
  assert.equal(readB.content, 'content-from-quotashift');

  const readAById = (await fx.service.call(fx.session.id, 'file_read', {
    workspaceId: fx.wA.id,
    path: '/a.txt',
  })) as any;
  assert.equal(readAById.content, 'content-from-aevra');
  fx.db.close();
});

test('3. Explicit writes work with multiple leases without SESSION_WORKSPACE_REQUIRED', async () => {
  const fx = setupMultiWorkspace();
  fx.sessions.grantConnectionWorkspace(fx.session.id, fx.wA.id, 'developer');
  fx.sessions.grantConnectionWorkspace(fx.session.id, fx.wB.id, 'developer');

  await fx.service.call(fx.session.id, 'file_write', {
    workspace: 'Aevra',
    path: '/w1.txt',
    content: 'hello A',
  });
  await fx.service.call(fx.session.id, 'file_write', {
    workspaceId: fx.wB.id,
    path: '/w2.txt',
    content: 'hello B',
  });

  assert.equal(readFileSync(path.join(fx.rootA, 'w1.txt'), 'utf8'), 'hello A');
  assert.equal(readFileSync(path.join(fx.rootB, 'w2.txt'), 'utf8'), 'hello B');
  fx.db.close();
});

test('4. Commands use requested workspace and bind to its workspaceId', async () => {
  const fx = setupMultiWorkspace();
  fx.sessions.grantConnectionWorkspace(fx.session.id, fx.wA.id, 'developer');
  fx.sessions.grantConnectionWorkspace(fx.session.id, fx.wB.id, 'developer');

  let resA: any = await fx.service.call(fx.session.id, 'command_run', {
    workspace: 'Aevra',
    command: { executable: 'git', args: ['status'] },
  });
  if (resA?.status === 'approval_pending') {
    fx.approvals.approve(resA.requestId, 'once');
    resA = await fx.service.call(fx.session.id, 'approval_wait', { requestId: resA.requestId });
  }

  assert.equal(fx.executedCommands.length, 1);
  assert.equal(fx.executedCommands[0].workspaceId, fx.wA.id);

  let resB: any = await fx.service.call(fx.session.id, 'command_run', {
    workspaceId: fx.wB.id,
    command: { executable: 'git', args: ['log'] },
  });
  if (resB?.status === 'approval_pending') {
    fx.approvals.approve(resB.requestId, 'once');
    resB = await fx.service.call(fx.session.id, 'approval_wait', { requestId: resB.requestId });
  }

  assert.equal(fx.executedCommands.length, 2);
  assert.equal(fx.executedCommands[1].workspaceId, fx.wB.id);
  fx.db.close();
});

test('5. Concurrent cross-workspace operations run without state cross-contamination', async () => {
  const fx = setupMultiWorkspace();
  fx.sessions.grantConnectionWorkspace(fx.session.id, fx.wA.id, 'developer');
  fx.sessions.grantConnectionWorkspace(fx.session.id, fx.wB.id, 'developer');

  const [resA, resB] = await Promise.all([
    fx.service.call(fx.session.id, 'file_read', { workspace: 'Aevra', path: '/a.txt' }),
    fx.service.call(fx.session.id, 'file_read', { workspace: 'Quotashift', path: '/b.txt' }),
  ]);

  assert.equal((resA as any).content, 'content-from-aevra');
  assert.equal((resB as any).content, 'content-from-quotashift');
  fx.db.close();
});

test('6. Missing target remains ambiguous and throws WORKSPACE_REQUIRED with list', async () => {
  const fx = setupMultiWorkspace();
  fx.sessions.grantConnectionWorkspace(fx.session.id, fx.wA.id, 'developer');
  fx.sessions.grantConnectionWorkspace(fx.session.id, fx.wB.id, 'developer');

  await assert.rejects(
    async () => fx.service.call(fx.session.id, 'file_read', { path: '/a.txt' }),
    (err: any) => {
      assert.equal(err.code, 'WORKSPACE_REQUIRED');
      assert.ok(err.message.includes('Multiple workspaces are granted'));
      assert.equal(err.details?.workspaces?.length, 2);
      return true;
    },
  );
  fx.db.close();
});

test('7. Approval resumes against frozen workspace when multiple leases exist', async () => {
  const fx = setupMultiWorkspace();
  fx.sessions.grantConnectionWorkspace(fx.session.id, fx.wA.id, 'developer');
  fx.sessions.grantConnectionWorkspace(fx.session.id, fx.wB.id, 'developer');

  const ticket = await fx.approvals.request({
    actor: fx.session.actor,
    sessionId: fx.session.id,
    workspaceId: fx.wA.id,
    operation: {
      family: 'commands:run',
      capability: 'commands.run',
      risk: 'HIGH',
      argsHash: 'testhash',
    },
    payload: {
      tool: 'command_run',
      workspaceId: fx.wA.id,
      args: { command: { executable: 'echo', args: ['hello'] } },
    },
    expectedState: {},
    risk: 'HIGH',
  });

  fx.approvals.approve(ticket.requestId, 'once');
  await fx.service.call(fx.session.id, 'approval_wait', { requestId: ticket.requestId });

  const lastCmd = fx.executedCommands[fx.executedCommands.length - 1];
  assert.ok(lastCmd);
  assert.equal(lastCmd.workspaceId, fx.wA.id);
  fx.db.close();
});

test('8. Processes remain workspace-owned across leases', async () => {
  const fx = setupMultiWorkspace();
  fx.sessions.grantConnectionWorkspace(fx.session.id, fx.wA.id, 'developer');
  fx.sessions.grantConnectionWorkspace(fx.session.id, fx.wB.id, 'developer');

  let startRes = (await fx.service.call(fx.session.id, 'process_start', {
    workspace: 'Aevra',
    executable: 'node',
    args: ['-e', 'setInterval(()=>{},1000)'],
  })) as any;
  if (startRes?.status === 'approval_pending') {
    fx.approvals.approve(startRes.requestId, 'once');
    startRes = (await fx.service.call(fx.session.id, 'approval_wait', {
      requestId: startRes.requestId,
    })) as any;
  }

  assert.ok(startRes.processId);
  const statusRes = (await fx.service.call(fx.session.id, 'process_status', {
    processId: startRes.processId,
  })) as any;
  assert.equal(statusRes.processId, startRes.processId);
  assert.equal(statusRes.state, 'running');

  const stopRes = (await fx.service.call(fx.session.id, 'process_stop', {
    processId: startRes.processId,
  })) as any;
  assert.equal(stopRes.state, 'stopped');
  fx.db.close();
});
