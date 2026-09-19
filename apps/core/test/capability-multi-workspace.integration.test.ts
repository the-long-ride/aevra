import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { ApprovalRepository } from '../../../packages/store/src/approvals.js';
import { AuditRepository } from '../../../packages/store/src/audit.js';
import { ApprovalService } from '../src/approvals/approval-service.js';
import { AuditService } from '../src/audit/audit-service.js';
import { resumeApproval } from '../../../packages/mcp-tools/src/approval-resume.js';
import type { McpRuntimeContext } from '../../../packages/mcp-tools/src/service-types.js';

function makeFixture() {
  const db = AevraDatabase.open(':memory:');
  const approvalRepo = new ApprovalRepository(db.raw());
  const auditRepo = new AuditRepository(db.raw());
  const auditService = new AuditService(auditRepo);
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

  let leasesMap = new Map<string, any>();

  const leaseA = {
    id: 'lease_a',
    sessionId: 's1',
    workspaceId: 'ws_a',
    actor: 'oauth:ChatGPT',
    capabilities: ['files.read', 'files.write'],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };

  const leaseB = {
    id: 'lease_b',
    sessionId: 's1',
    workspaceId: 'ws_b',
    actor: 'oauth:ChatGPT',
    capabilities: ['files.read', 'files.write'],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };

  leasesMap.set('ws_a', leaseA);
  leasesMap.set('ws_b', leaseB);

  const innerCalls: any[] = [];

  const context: McpRuntimeContext = {
    approvals,
    sessions: {
      get: (id: string) => (id === 's1' ? (session as any) : null),
      activeLease: () => (leasesMap.size === 1 ? [...leasesMap.values()][0] : null),
      leases: () => [...leasesMap.values()],
      leaseForWorkspace: (_sId: string, wsId: string) => leasesMap.get(wsId) ?? null,
      connectionIdentity: () => ({
        actor: session.actor,
        subject: session.subject,
        connectionId: session.connectionId,
      }),
    } as any,
    workspaces: {
      getLocal: (id: string) =>
        id === 'ws_a'
          ? { id: 'ws_a', name: 'Workspace A', hostRoot: '/tmp/ws_a' }
          : id === 'ws_b'
            ? { id: 'ws_b', name: 'Workspace B', hostRoot: '/tmp/ws_b' }
            : null,
      capabilityRoots: () => [],
    } as any,
    deps: {
      permissions: {
        decide: () => ({ outcome: 'allow' }),
        check: () => ({ outcome: 'allow' }),
      } as any,
    },
    callInner: async (sId: string, tool: string, args: any) => {
      innerCalls.push({ sessionId: sId, tool, args });
      return { executed: true, tool, args };
    },
    oneTimeCapabilities: new Set<string>(),
  } as any;

  return {
    db,
    approvals,
    approvalRepo,
    context,
    innerCalls,
    leasesMap,
    addWorkspaceB: () => leasesMap.set('ws_b', leaseB),
    removeWorkspaceB: () => leasesMap.delete('ws_b'),
    removeWorkspaceA: () => leasesMap.delete('ws_a'),
  };
}

test('N2: Capability approval succeeds when session has multiple workspace grants', async () => {
  const f = makeFixture();
  try {
    // Both workspace A and B are granted
    assert.equal(f.leasesMap.size, 2);
    assert.equal(
      f.context.sessions.activeLease('s1'),
      null,
      'activeLease must return null for multi-grant session',
    );

    // Request capability approval for an operation targeting workspace A
    const req = await f.approvals.request({
      actor: 'oauth:ChatGPT',
      sessionId: 's1',
      workspaceId: 'ws_a',
      operation: {
        family: 'files:write',
        capability: 'files.write',
        risk: 'HIGH',
        argsHash: 'hash_write_a',
      },
      payload: {
        tool: 'capability_request',
        permissionMatcher: 'files:write',
        original: {
          tool: 'file_write',
          args: { path: 'config.json', content: '{"ok":true}', workspaceId: 'ws_a' },
        },
      },
      expectedState: {},
      risk: 'HIGH',
    });
    f.approvals.approve(req.requestId, 'once');

    // Resume the approval
    const result: any = await resumeApproval(f.context, 's1', req.requestId);
    assert.equal(result.executed, true);
    assert.equal(result.tool, 'file_write');
    assert.equal(
      result.args.workspaceId,
      'ws_a',
      'frozen workspaceId ws_a must be preserved in execution args',
    );
    assert.equal(f.innerCalls.length, 1);
    assert.equal(f.innerCalls[0].args.workspaceId, 'ws_a');
  } finally {
    f.db.close();
  }
});

test('N2: Removing target workspace A before resumption rejects the ticket', async () => {
  const f = makeFixture();
  try {
    const req = await f.approvals.request({
      actor: 'oauth:ChatGPT',
      sessionId: 's1',
      workspaceId: 'ws_a',
      operation: {
        family: 'files:write',
        capability: 'files.write',
        risk: 'HIGH',
        argsHash: 'hash_write_a2',
      },
      payload: {
        tool: 'capability_request',
        permissionMatcher: 'files:write',
        original: {
          tool: 'file_write',
          args: { path: 'config.json', workspaceId: 'ws_a' },
        },
      },
      expectedState: {},
      risk: 'HIGH',
    });
    f.approvals.approve(req.requestId, 'once');

    // Remove workspace A before resumption
    f.removeWorkspaceA();

    await assert.rejects(
      () => resumeApproval(f.context, 's1', req.requestId),
      (err: any) =>
        err.code === 'APPROVAL_CONTEXT_CHANGED' || err.message.includes('workspace changed'),
    );

    assert.equal(
      f.innerCalls.length,
      0,
      'zero operations dispatched when target workspace is removed',
    );
  } finally {
    f.db.close();
  }
});

test('N2: Adding or removing unrelated workspace B does not invalidate workspace A approval', async () => {
  const f = makeFixture();
  try {
    // Start with only workspace A
    f.removeWorkspaceB();
    assert.equal(f.leasesMap.size, 1);

    const req = await f.approvals.request({
      actor: 'oauth:ChatGPT',
      sessionId: 's1',
      workspaceId: 'ws_a',
      operation: {
        family: 'files:write',
        capability: 'files.write',
        risk: 'HIGH',
        argsHash: 'hash_write_a3',
      },
      payload: {
        tool: 'capability_request',
        permissionMatcher: 'files:write',
        original: {
          tool: 'file_write',
          args: { path: 'a.txt', workspaceId: 'ws_a' },
        },
      },
      expectedState: {},
      risk: 'HIGH',
    });
    f.approvals.approve(req.requestId, 'once');

    // Now add workspace B (grant count becomes 2)
    f.addWorkspaceB();
    assert.equal(f.leasesMap.size, 2);

    // Resumption for workspace A must still succeed
    const result: any = await resumeApproval(f.context, 's1', req.requestId);
    assert.equal(result.executed, true);
    assert.equal(result.args.workspaceId, 'ws_a');

    // Now remove workspace B (grant count back to 1) and verify another approval for A
    f.removeWorkspaceB();
    const req2 = await f.approvals.request({
      actor: 'oauth:ChatGPT',
      sessionId: 's1',
      workspaceId: 'ws_a',
      operation: {
        family: 'files:write',
        capability: 'files.write',
        risk: 'HIGH',
        argsHash: 'hash_write_a4',
      },
      payload: {
        tool: 'capability_request',
        permissionMatcher: 'files:write',
        original: {
          tool: 'file_write',
          args: { path: 'a2.txt', workspaceId: 'ws_a' },
        },
      },
      expectedState: {},
      risk: 'HIGH',
    });
    f.approvals.approve(req2.requestId, 'once');

    const result2: any = await resumeApproval(f.context, 's1', req2.requestId);
    assert.equal(result2.executed, true);
  } finally {
    f.db.close();
  }
});
