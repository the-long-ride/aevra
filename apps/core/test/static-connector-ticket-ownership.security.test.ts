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

  const sessions = new Map<string, any>();

  // Two sessions sharing the exact same static connector token & subject
  sessions.set('ses_conn_a', {
    id: 'ses_conn_a',
    actor: 'connector:token_hash_xyz',
    subject: 'con_review',
  });
  sessions.set('ses_conn_b', {
    id: 'ses_conn_b',
    actor: 'connector:token_hash_xyz',
    subject: 'con_review',
  });

  // Two sessions sharing the exact same OAuth connection
  sessions.set('ses_oauth_c', {
    id: 'ses_oauth_c',
    actor: 'oauth:ChatGPT',
    subject: 'sub_oauth_123',
    connectionId: 'conn_oauth_1',
  });
  sessions.set('ses_oauth_d', {
    id: 'ses_oauth_d',
    actor: 'oauth:ChatGPT',
    subject: 'sub_oauth_123',
    connectionId: 'conn_oauth_1',
  });

  approvals.setSessionIdentityResolver((sessionId: string) => {
    const s = sessions.get(sessionId);
    return s ? { actor: s.actor, subject: s.subject, connectionId: s.connectionId } : null;
  });

  const context: McpRuntimeContext = {
    approvals,
    sessions: {
      get: (id: string) => sessions.get(id) ?? null,
      connectionIdentity: (id: string) => {
        const s = sessions.get(id);
        return s ? { actor: s.actor, subject: s.subject, connectionId: s.connectionId } : null;
      },
    } as any,
    workspaces: {
      getLocal: () => ({ id: 'w1', name: 'W1' }),
    } as any,
    deps: {},
  } as any;

  return {
    db,
    approvals,
    approvalRepo,
    sessions,
    context,
  };
}

test('N3: Static connector tickets are null-owned and never disclosed across sessions', async () => {
  const f = makeFixture();
  try {
    // Session A requests an approval through ApprovalService
    const req = await f.approvals.request({
      actor: 'connector:token_hash_xyz',
      sessionId: 'ses_conn_a',
      workspaceId: 'w1',
      operation: {
        family: 'files:read',
        capability: 'files.read',
        risk: 'HIGH',
        argsHash: 'hash_read_static',
      },
      payload: { tool: 'file_read', args: { path: '/secret/sensitive.txt' } },
      expectedState: {},
      risk: 'HIGH',
    });

    // 1. Assert persisted ticket has null/undefined connectionId and connectionSubject
    const rawTicket = f.approvalRepo.get(req.requestId);
    assert.ok(rawTicket, 'ticket must be persisted');
    assert.equal(
      rawTicket.connectionId,
      undefined,
      'static connector ticket must not have connectionId',
    );
    assert.equal(
      rawTicket.connectionSubject,
      undefined,
      'static connector ticket must not have connectionSubject',
    );

    // 2. Visible to Session A
    const callerA = {
      actor: 'connector:token_hash_xyz',
      sessionId: 'ses_conn_a',
      subject: 'con_review',
    };
    const statusA = f.approvals.status(req.requestId, callerA);
    assert.ok(statusA, 'ticket must be visible to originating static session A');
    assert.equal(statusA.id, req.requestId);

    // 3. Hidden from Session B (same static connector, different session)
    const callerB = {
      actor: 'connector:token_hash_xyz',
      sessionId: 'ses_conn_b',
      subject: 'con_review',
    };
    const statusB = f.approvals.status(req.requestId, callerB);
    assert.equal(statusB, null, 'ticket must be hidden from static session B');

    // 4. Session B cannot cancel Session A ticket
    assert.throws(
      () => f.approvals.cancel(req.requestId, 'client_cancelled', callerB),
      (err: any) => err.code === 'APPROVAL_NOT_FOUND',
      'Session B cannot cancel Session A ticket',
    );

    // 5. resumeApproval via session B returns null (not authorized)
    const resumeRes = await resumeApproval(f.context, 'ses_conn_b', req.requestId);
    assert.equal(resumeRes, null, 'resumeApproval must return null to session B');
  } finally {
    f.db.close();
  }
});

test('N3: Verified OAuth connection tickets retain connection ownership across sessions', async () => {
  const f = makeFixture();
  try {
    // Session C (OAuth) requests an approval
    const req = await f.approvals.request({
      actor: 'oauth:ChatGPT',
      sessionId: 'ses_oauth_c',
      workspaceId: 'w1',
      operation: {
        family: 'files:read',
        capability: 'files.read',
        risk: 'HIGH',
        argsHash: 'hash_read_oauth',
      },
      payload: { tool: 'file_read', args: { path: '/oauth/file.txt' } },
      expectedState: {},
      risk: 'HIGH',
    });

    // Persisted ticket has connection ownership
    const rawTicket = f.approvalRepo.get(req.requestId);
    assert.ok(rawTicket);
    assert.equal(rawTicket.connectionId, 'conn_oauth_1');
    assert.equal(rawTicket.connectionSubject, 'conn_oauth_1');

    // Session D (same OAuth connection) CAN see the ticket
    const callerD = {
      actor: 'oauth:ChatGPT',
      sessionId: 'ses_oauth_d',
      subject: 'sub_oauth_123',
      connectionId: 'conn_oauth_1',
    };
    const statusD = f.approvals.status(req.requestId, callerD);
    assert.ok(statusD, 'ticket must be visible to peer OAuth session D under same connection');
    assert.equal(statusD.id, req.requestId);
  } finally {
    f.db.close();
  }
});
