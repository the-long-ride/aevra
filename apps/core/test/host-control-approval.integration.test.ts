import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { ApprovalRepository } from '../../../packages/store/src/approvals.js';
import { AuditRepository } from '../../../packages/store/src/audit.js';
import { AuditService } from '../src/audit/audit-service.js';
import { ApprovalService } from '../src/approvals/approval-service.js';
import { HostControlGrantRepository } from '../../../packages/store/src/host-control-grants.js';
import { HostControlAccess } from '../src/control/host-control-access.js';
import { HostControlApproval } from '../src/control/host-control-approval.js';
import { resumeApproval } from '../../../packages/mcp-tools/src/approval-resume.js';

test('host approval is deduplicated and grants only the exact connection capability', async () => {
  const db = AevraDatabase.open(':memory:');
  const identities = new Map([
    ['s1', { actor: 'oauth:ChatGPT', subject: 'one', connectionId: 'one' }],
    ['s2', { actor: 'oauth:ChatGPT', subject: 'two', connectionId: 'two' }],
  ]);
  const sessions = {
    connectionIdentity: (id: string) => identities.get(id) ?? null,
    connectionState: (id: string) => ({
      status: id === 'one' || id === 'two' ? 'CONNECTED' : 'REVOKED',
    }),
  } as any;
  const access = new HostControlAccess(sessions, new HostControlGrantRepository(db.raw()));
  const audit = new AuditService(new AuditRepository(db.raw()));
  const approvals = new ApprovalService(new ApprovalRepository(db.raw()), audit, {
    fastWaitMs: 0,
    lifetimeMs: 300000,
    lifetimeByRiskMs: {},
  });
  approvals.setSessionIdentityResolver(sessions.connectionIdentity);
  const host = new HostControlApproval(sessions, access, approvals);
  const a = await host.requestHostControl('s1', 'browser.control', {
    tool: 'browser_status',
    args: {},
  });
  const b = await host.requestHostControl('s1', 'browser.control', {
    tool: 'browser_status',
    args: {},
  });
  assert.equal(a.status, 'approval_pending');
  assert.ok('requestId' in a && a.requestId);
  assert.ok('requestId' in b && b.requestId);
  assert.equal(a.requestId, b.requestId);
  const row = db
    .raw()
    .prepare('SELECT scope,workspace_id,identity_key FROM pending_approvals WHERE id=?')
    .get(a.requestId) as any;
  assert.deepEqual([row.scope, row.workspace_id, row.identity_key], ['host', null, 'one']);
  assert.equal(host.canResume('s2', a.requestId), false);
  assert.throws(() => approvals.approve(a.requestId), /connection scope/i);
  approvals.approve(a.requestId, 'connection');
  const approvedEvent = JSON.parse(audit.exportJson()).find(
    (entry: any) => entry.event.decision === 'approved:connection',
  ).event;
  assert.equal(approvedEvent.connectionId, 'one');
  assert.equal('workspaceId' in approvedEvent, false);
  const resumeContext = {
    approvals,
    sessions: {
      ...sessions,
      get: (id: string) => (identities.get(id) ? { ...identities.get(id), id } : null),
    },
    deps: { hostControlAccess: access, hostControlApproval: host },
  } as any;
  assert.equal(await resumeApproval(resumeContext, 's2', a.requestId), null);
  assert.deepEqual(await resumeApproval(resumeContext, 's1', a.requestId), {
    status: 'approved',
    capability: 'browser.control',
  });
  assert.equal(access.has('s1', 'browser.control'), true);
  assert.equal(access.has('s2', 'browser.control'), false);
  assert.equal(access.has('s1', 'desktop.control'), false);

  const identity = access.identity('s1')!;
  access.revoke(identity, 'browser.control');
  const afterRevocation = await host.requestHostControl('s1', 'browser.control', {
    tool: 'browser_status',
    args: {},
  });
  assert.equal(afterRevocation.status, 'approval_pending');
  assert.notEqual(afterRevocation.requestId, a.requestId);
  db.close();
});

test('revoked OAuth connection cannot turn a pending request into a host grant', async () => {
  const db = AevraDatabase.open(':memory:');
  let status = 'CONNECTED';
  const sessions = {
    connectionIdentity: () => ({ actor: 'oauth:ChatGPT', subject: 'one', connectionId: 'one' }),
    connectionState: () => ({ status }),
  } as any;
  const access = new HostControlAccess(sessions, new HostControlGrantRepository(db.raw()));
  const approvals = new ApprovalService(
    new ApprovalRepository(db.raw()),
    new AuditService(new AuditRepository(db.raw())),
    {
      fastWaitMs: 0,
      lifetimeMs: 300000,
      lifetimeByRiskMs: {},
    },
  );
  approvals.setSessionIdentityResolver(sessions.connectionIdentity);
  const host = new HostControlApproval(sessions, access, approvals);
  const request = await host.requestHostControl('s1', 'browser.control', {
    tool: 'browser_status',
    args: {},
  });
  assert.ok('requestId' in request && request.requestId);
  status = 'REVOKED';
  assert.throws(() => approvals.approve(request.requestId, 'connection'), /revoked/i);
  assert.equal(approvals.status(request.requestId)?.state, 'PENDING');
  assert.equal(access.has('s1', 'browser.control'), false);
  db.close();
});

test('failed host grant persistence leaves the approval pending', async () => {
  const db = AevraDatabase.open(':memory:');
  const sessions = {
    connectionIdentity: () => ({ actor: 'oauth:ChatGPT', subject: 'one', connectionId: 'one' }),
    connectionState: () => ({ status: 'CONNECTED' }),
  } as any;
  const access = new HostControlAccess(sessions, new HostControlGrantRepository(db.raw()));
  const approvals = new ApprovalService(
    new ApprovalRepository(db.raw()),
    new AuditService(new AuditRepository(db.raw())),
    { fastWaitMs: 0, lifetimeMs: 300000, lifetimeByRiskMs: {} },
  );
  approvals.setSessionIdentityResolver(sessions.connectionIdentity);
  const host = new HostControlApproval(sessions, access, approvals);
  const request = await host.requestHostControl('s1', 'browser.control', {
    tool: 'browser_status',
    args: {},
  });
  assert.ok('requestId' in request && request.requestId);
  access.grant = () => {
    throw new Error('grant write failed');
  };

  assert.throws(() => approvals.approve(request.requestId, 'connection'), /grant write failed/);
  assert.equal(approvals.status(request.requestId)?.state, 'PENDING');
  db.close();
});
