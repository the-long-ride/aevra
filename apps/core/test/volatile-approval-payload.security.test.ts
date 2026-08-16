import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { ApprovalRepository } from '../../../packages/store/src/approvals.js';
import { AuditRepository } from '../../../packages/store/src/audit.js';
import { AuditService } from '../src/audit/audit-service.js';
import { ApprovalService } from '../src/approvals/approval-service.js';

function make() {
  const db = AevraDatabase.open(':memory:');
  const approvals = new ApprovalService(
    new ApprovalRepository(db.raw()),
    new AuditService(new AuditRepository(db.raw())),
    { fastWaitMs: 0, lifetimeMs: 300_000, lifetimeByRiskMs: {} },
  );
  return { db, approvals };
}

test('approval persistence excludes raw inline env while resume retains volatile execution values', async () => {
  const { db, approvals } = make();
  const secret = 'synthetic-inline-env-secret-4FCA';
  const request = await approvals.request({
    actor: 'oauth:ChatGPT',
    sessionId: 'ses_1',
    workspaceId: 'ws_1',
    operation: {
      family: 'node:run:host-fallback',
      capability: 'commands.run',
      risk: 'MEDIUM',
      argsHash: 'hash',
    },
    payload: {
      tool: 'command_run',
      args: {
        command: {
          executable: process.execPath,
          args: ['-e', 'process.exit(0)'],
          env: { API_TOKEN: secret },
        },
        executionMode: 'host',
      },
    },
    expectedState: {},
    risk: 'MEDIUM',
  });

  const stored = db
    .raw()
    .prepare('SELECT operation_json operationJson FROM pending_approvals WHERE id=?')
    .get(request.requestId) as any;
  assert.equal(String(stored.operationJson).includes(secret), false);
  assert.match(String(stored.operationJson), /API_TOKEN/);

  const visible = approvals.status(request.requestId) as any;
  assert.equal(JSON.stringify(visible).includes(secret), false);

  approvals.approve(request.requestId, 'once');
  let resumedSecret = '';
  await approvals.resume(
    request.requestId,
    async () => ({ ok: true }),
    async (ticket) => {
      resumedSecret = String((ticket.payload as any)?.args?.command?.env?.API_TOKEN ?? '');
      return { ok: true };
    },
  );
  assert.equal(resumedSecret, secret);
  db.close();
});

test('security-sensitive file content is not stored in approval rows', async () => {
  const { db, approvals } = make();
  const secretContent = '//registry.example/:_authToken=synthetic-file-secret-CC92';
  const request = await approvals.request({
    actor: 'oauth:ChatGPT',
    sessionId: 'ses_1',
    workspaceId: 'ws_1',
    operation: {
      family: 'security:sensitive:file_write',
      capability: 'files.write',
      risk: 'HIGH',
      argsHash: 'hash',
    },
    payload: {
      tool: 'capability_request',
      securityOnce: true,
      requestedCapability: 'files.write',
      permissionMatcher: '*',
      original: {
        tool: 'file_write',
        args: { path: '/.npmrc', content: secretContent },
      },
    },
    expectedState: { workspaceId: 'ws_1' },
    risk: 'HIGH',
  });
  const stored = db
    .raw()
    .prepare('SELECT operation_json operationJson FROM pending_approvals WHERE id=?')
    .get(request.requestId) as any;
  assert.equal(String(stored.operationJson).includes(secretContent), false);
  db.close();
});

test('security-sensitive file patches are not stored in approval rows', async () => {
  const { db, approvals } = make();
  const patchSecret = 'short-secret-42';
  const patch = `@@ -1 +1 @@\n-old\n+TOKEN=${patchSecret}`;
  const request = await approvals.request({
    actor: 'oauth:ChatGPT',
    sessionId: 'ses_1',
    workspaceId: 'ws_1',
    operation: {
      family: 'security:sensitive:file_patch',
      capability: 'files.write',
      risk: 'HIGH',
      argsHash: 'hash',
    },
    payload: {
      tool: 'capability_request',
      securityOnce: true,
      requestedCapability: 'files.write',
      permissionMatcher: '*',
      original: {
        tool: 'file_patch',
        args: { path: '/.npmrc', patch },
      },
    },
    expectedState: { workspaceId: 'ws_1' },
    risk: 'HIGH',
  });
  const stored = db
    .raw()
    .prepare('SELECT operation_json operationJson FROM pending_approvals WHERE id=?')
    .get(request.requestId) as any;
  assert.equal(String(stored.operationJson).includes(patchSecret), false);
  assert.equal(String(stored.operationJson).includes(patch), false);
  db.close();
});
