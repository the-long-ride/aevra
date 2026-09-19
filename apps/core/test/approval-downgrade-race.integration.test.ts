import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { ApprovalRepository } from '../../../packages/store/src/approvals.js';
import { AuditRepository } from '../../../packages/store/src/audit.js';
import { PermissionRepository } from '../../../packages/store/src/permissions.js';
import { ApprovalService } from '../src/approvals/approval-service.js';
import { AuditService } from '../src/audit/audit-service.js';
import { PermissionEngine } from '../src/policy/permissions.js';
import { resumeApproval } from '../../../packages/mcp-tools/src/approval-resume.js';
import type { McpRuntimeContext } from '../../../packages/mcp-tools/src/service-types.js';

function makeFixture() {
  const db = AevraDatabase.open(':memory:');
  const approvalRepo = new ApprovalRepository(db.raw());
  const auditRepo = new AuditRepository(db.raw());
  const permRepo = new PermissionRepository(db.raw());
  const auditService = new AuditService(auditRepo);
  const permissions = new PermissionEngine(permRepo);
  const approvals = new ApprovalService(approvalRepo, auditService, {
    fastWaitMs: 0,
    lifetimeMs: 60_000,
    lifetimeByRiskMs: {},
  });

  approvals.setSessionIdentityResolver((sessionId: string) => {
    if (sessionId === 's1') {
      return { actor: 'oauth:ChatGPT', subject: 'sub_test', connectionId: 'conn_test' };
    }
    return null;
  });

  const session = {
    id: 's1',
    actor: 'oauth:ChatGPT',
    subject: 'sub_test',
    connectionId: 'conn_test',
  };
  let currentLease = {
    id: 'lease_1',
    sessionId: 's1',
    workspaceId: 'w1',
    actor: 'oauth:ChatGPT',
    capabilities: ['files.read', 'files.write', 'git.commit', 'git.push'] as any[],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };

  const dispatchedMutations: string[] = [];
  let onHeadCheck: (() => Promise<void>) | null = null;

  const context: McpRuntimeContext = {
    approvals,
    sessions: {
      get: (id: string) => (id === 's1' ? (session as any) : null),
      activeLease: () => currentLease as any,
      leases: () => [currentLease as any],
      leaseForWorkspace: (_sId: string, wsId: string) =>
        wsId === currentLease.workspaceId ? (currentLease as any) : null,
      connectionIdentity: () => ({
        actor: session.actor,
        subject: session.subject,
        connectionId: session.connectionId,
      }),
      grantConnectionWorkspace: () => currentLease as any,
      switchWorkspace: async () => ({ status: 'admitted', lease: currentLease as any }),
    } as any,
    workspaces: {
      getLocal: (id: string) => ({ id, name: 'Main', hostRoot: '/tmp/test' }) as any,
      capabilityRoots: () => [{ logical: '', physical: '/tmp/test' }],
    } as any,
    deps: {
      permissions,
      manifests: { summarize: () => null } as any,
    },
    worker: {
      execute: async (input: any) => {
        if (input.operation?.kind === 'git.state' || input.operation?.kind === 'git.log') {
          if (onHeadCheck) await onHeadCheck();
          return {
            ok: true,
            value: { stdout: 'commit_sha_123\n', head: 'commit_sha_123', status: [] },
          };
        }
        if (input.operation?.kind === 'git.commit') {
          dispatchedMutations.push('git.commit');
          return { ok: true, value: { commitId: 'sha_new' } };
        }
        return { ok: false, error: { code: 'UNSUPPORTED', message: 'unexpected operation' } };
      },
    } as any,
    oneTimeCapabilities: new Set<string>(),
  } as any;

  return {
    db,
    approvals,
    approvalRepo,
    auditRepo,
    permissions,
    permRepo,
    context,
    dispatchedMutations,
    setLeaseCapabilities: (caps: any[]) => {
      currentLease = { ...currentLease, capabilities: caps };
    },
    setOnHeadCheck: (fn: (() => Promise<void>) | null) => {
      onHeadCheck = fn;
    },
  };
}

test('N1: Profile downgrade during repository validation prevents Git dispatch', async () => {
  const f = makeFixture();
  try {
    const req = await f.approvals.request({
      actor: 'oauth:ChatGPT',
      sessionId: 's1',
      workspaceId: 'w1',
      operation: {
        family: 'git:commit',
        capability: 'git.commit',
        risk: 'HIGH',
        argsHash: 'hash_commit',
      },
      payload: { tool: 'git_commit', args: { message: 'commit during validation' } },
      expectedState: { head: 'commit_sha_123' },
      risk: 'HIGH',
    });
    f.approvals.approve(req.requestId, 'once');

    let inValidation!: () => void;
    const inValidationP = new Promise<void>((r) => {
      inValidation = r;
    });

    let canFinishHeadCheck!: () => void;
    const canFinishHeadCheckP = new Promise<void>((r) => {
      canFinishHeadCheck = r;
    });

    f.setOnHeadCheck(async () => {
      inValidation();
      await canFinishHeadCheckP;
    });

    // Start resumption in background
    const resumeP = resumeApproval(f.context, 's1', req.requestId);

    // Wait until repoState head check is in flight
    await inValidationP;

    // Operator downgrades the workspace lease from developer to read-only (removes git.commit)
    f.setLeaseCapabilities(['files.read']);

    // Release the barrier
    canFinishHeadCheck();

    // Resumption must fail with APPROVAL_CONTEXT_CHANGED
    await assert.rejects(
      () => resumeP,
      (err: any) =>
        err.code === 'APPROVAL_CONTEXT_CHANGED' || err.message.includes('capability changed'),
    );

    // Zero git.commit mutations must be dispatched to the worker
    assert.equal(f.dispatchedMutations.length, 0, 'zero Git mutations dispatched after downgrade');

    // Ticket state must be FAILED (claimed execution aborted truthfully)
    const stored = f.approvalRepo.get(req.requestId);
    assert.equal(stored?.state, 'FAILED');

    // Audit trail records resume_rejected
    const auditEvents = f.auditRepo.list().map((r: any) => JSON.parse(r.event_json));
    const rejectedEvent = auditEvents.find(
      (row: any) => row.decision === 'resume_rejected' && row.result.includes('capability changed'),
    );
    assert.ok(rejectedEvent, 'audit trail must record resume_rejected with capability changed');
  } finally {
    f.db.close();
  }
});

test('N1: Deny-policy change during repository validation prevents Git dispatch', async () => {
  const f = makeFixture();
  try {
    const req = await f.approvals.request({
      actor: 'oauth:ChatGPT',
      sessionId: 's1',
      workspaceId: 'w1',
      operation: {
        family: 'git:commit',
        capability: 'git.commit',
        risk: 'HIGH',
        argsHash: 'hash_commit_deny',
      },
      payload: { tool: 'git_commit', args: { message: 'commit denied during validation' } },
      expectedState: { head: 'commit_sha_123' },
      risk: 'HIGH',
    });
    f.approvals.approve(req.requestId, 'once');

    let inValidation!: () => void;
    const inValidationP = new Promise<void>((r) => {
      inValidation = r;
    });

    let canFinishHeadCheck!: () => void;
    const canFinishHeadCheckP = new Promise<void>((r) => {
      canFinishHeadCheck = r;
    });

    f.setOnHeadCheck(async () => {
      inValidation();
      await canFinishHeadCheckP;
    });

    const resumeP = resumeApproval(f.context, 's1', req.requestId);
    await inValidationP;

    // Operator adds a deny permission policy rule for git.commit
    f.permRepo.upsert({
      id: 'rule_deny_git',
      capability: 'git.commit',
      matcher: '*',
      effect: 'deny',
      scope: 'system',
      createdAt: new Date().toISOString(),
    });

    canFinishHeadCheck();

    await assert.rejects(
      () => resumeP,
      (err: any) =>
        err.code === 'APPROVAL_CONTEXT_CHANGED' ||
        err.message.includes('permission policy changed'),
    );

    assert.equal(
      f.dispatchedMutations.length,
      0,
      'zero Git mutations dispatched after deny rule added',
    );
    const stored = f.approvalRepo.get(req.requestId);
    assert.equal(stored?.state, 'FAILED');

    const auditEvents2 = f.auditRepo.list().map((r: any) => JSON.parse(r.event_json));
    const rejectedEvent = auditEvents2.find(
      (row: any) =>
        row.decision === 'resume_rejected' && row.result.includes('permission policy changed'),
    );
    assert.ok(
      rejectedEvent,
      'audit trail must record resume_rejected with permission policy changed',
    );
  } finally {
    f.db.close();
  }
});

test('N1: Unchanged authority completes Git dispatch successfully', async () => {
  const f = makeFixture();
  try {
    const req = await f.approvals.request({
      actor: 'oauth:ChatGPT',
      sessionId: 's1',
      workspaceId: 'w1',
      operation: {
        family: 'git:commit',
        capability: 'git.commit',
        risk: 'HIGH',
        argsHash: 'hash_commit_ok',
      },
      payload: { tool: 'git_commit', args: { message: 'valid commit' } },
      expectedState: { head: 'commit_sha_123' },
      risk: 'HIGH',
    });
    f.approvals.approve(req.requestId, 'once');

    let inValidation!: () => void;
    const inValidationP = new Promise<void>((r) => {
      inValidation = r;
    });

    let canFinishHeadCheck!: () => void;
    const canFinishHeadCheckP = new Promise<void>((r) => {
      canFinishHeadCheck = r;
    });

    f.setOnHeadCheck(async () => {
      inValidation();
      await canFinishHeadCheckP;
    });

    const resumeP = resumeApproval(f.context, 's1', req.requestId);
    await inValidationP;

    // Authority is unchanged
    canFinishHeadCheck();

    const result = await resumeP;
    assert.deepEqual(result, { commitId: 'sha_new' });
    assert.deepEqual(f.dispatchedMutations, ['git.commit']);

    const stored = f.approvalRepo.get(req.requestId);
    assert.equal(stored?.state, 'SUCCEEDED');
  } finally {
    f.db.close();
  }
});
