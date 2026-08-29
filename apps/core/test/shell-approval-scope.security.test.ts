import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { ApprovalRepository } from '../../../packages/store/src/approvals.js';
import { AuditRepository } from '../../../packages/store/src/audit.js';
import { AuditService } from '../src/audit/audit-service.js';
import { ApprovalService } from '../src/approvals/approval-service.js';

function make() {
  const db = AevraDatabase.open(':memory:');
  const svc = new ApprovalService(
    new ApprovalRepository(db.raw()),
    new AuditService(new AuditRepository(db.raw())),
    { fastWaitMs: 0, lifetimeMs: 300000, lifetimeByRiskMs: {} },
  );
  return { db, svc };
}

async function shellRequest(svc: ApprovalService) {
  return svc.request({
    actor: 'connector:test',
    sessionId: 's1',
    workspaceId: 'w1',
    operation: {
      family: 'shell:bash:*:host-fallback',
      capability: 'commands.run',
      risk: 'HIGH',
      argsHash: 'h',
    },
    payload: { tool: 'command_run', sourceTool: 'shell_run', shell: 'bash', script: 'ls' },
    expectedState: {},
    risk: 'HIGH',
  });
}

test('shell operations refuse every persistent approval scope', async () => {
  const { db, svc } = make();
  for (const scope of ['session', 'always-workspace', 'always-all']) {
    const request = await shellRequest(svc);
    assert.throws(
      () => svc.approve(request.requestId, scope),
      /Shell execution only supports one-time local approval/,
      `scope ${scope} must be refused`,
    );
  }
  db.close();
});

test('shell operations still accept one-time approval', async () => {
  const { db, svc } = make();
  const request = await shellRequest(svc);
  assert.doesNotThrow(() => svc.approve(request.requestId, 'once'));
  assert.equal(svc.status(request.requestId)?.state, 'APPROVED');
  db.close();
});

test('non-shell command families still support persistent scopes', async () => {
  const { db, svc } = make();
  const request = await svc.request({
    actor: 'connector:test',
    sessionId: 's1',
    workspaceId: 'w1',
    operation: { family: 'npm:test', capability: 'commands.run', risk: 'LOW', argsHash: 'h' },
    payload: { tool: 'command_run' },
    expectedState: {},
    risk: 'LOW',
  });
  assert.doesNotThrow(() => svc.approve(request.requestId, 'always-workspace'));
  db.close();
});

test('a non-command family that merely looks shell-like is unaffected', async () => {
  const { db, svc } = make();
  const request = await svc.request({
    actor: 'connector:test',
    sessionId: 's1',
    workspaceId: 'w1',
    operation: { family: 'shell:notes', capability: 'files.read', risk: 'LOW', argsHash: 'h' },
    payload: {},
    expectedState: {},
    risk: 'LOW',
  });
  assert.doesNotThrow(() => svc.approve(request.requestId, 'session'));
  db.close();
});
