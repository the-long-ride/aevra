import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { ApprovalRepository } from '../../../packages/store/src/approvals.js';
import { AuditRepository } from '../../../packages/store/src/audit.js';
import { ApprovalService } from '../src/approvals/approval-service.js';
import { AuditService } from '../src/audit/audit-service.js';

test('F4: competing validation failure does not overwrite claimed execution', async () => {
  const db = AevraDatabase.open(':memory:');
  const approvalRepo = new ApprovalRepository(db.raw());
  const auditRepo = new AuditRepository(db.raw());
  const auditService = new AuditService(auditRepo);
  const approvals = new ApprovalService(approvalRepo, auditService, {
    fastWaitMs: 0,
    lifetimeMs: 60_000,
    lifetimeByRiskMs: {},
  });

  // Request and approve ticket
  const req = await approvals.request({
    actor: 'oauth:ChatGPT',
    sessionId: 'ses_1',
    workspaceId: 'ws_1',
    operation: {
      family: 'files:delete',
      capability: 'files.delete',
      risk: 'HIGH',
      argsHash: 'x',
    },
    payload: { tool: 'file_delete', args: { path: '/file.txt' } },
    expectedState: {},
    risk: 'HIGH',
  });
  approvals.approve(req.requestId, 'once');

  // Barriers to ensure:
  // 1. Both callers read APPROVED and enter revalidate
  let winnerInValidation!: () => void;
  const winnerInValidationP = new Promise<void>((r) => {
    winnerInValidation = r;
  });

  let loserInValidation!: () => void;
  const loserInValidationP = new Promise<void>((r) => {
    loserInValidation = r;
  });

  let winnerCanFinishValidation!: () => void;
  const winnerCanFinishValidationP = new Promise<void>((r) => {
    winnerCanFinishValidation = r;
  });

  let winnerInsideExecutor!: () => void;
  const winnerInsideExecutorP = new Promise<void>((r) => {
    winnerInsideExecutor = r;
  });

  let loserCanFinishValidation!: () => void;
  const loserCanFinishValidationP = new Promise<void>((r) => {
    loserCanFinishValidation = r;
  });

  let winnerCanComplete!: () => void;
  const winnerCanCompleteP = new Promise<void>((r) => {
    winnerCanComplete = r;
  });

  let executionCount = 0;

  // Caller 1: Winner
  const winnerPromise = approvals.resume(
    req.requestId,
    async () => {
      winnerInValidation();
      await winnerCanFinishValidationP;
      return { ok: true as const };
    },
    async () => {
      executionCount++;
      winnerInsideExecutor();
      await winnerCanCompleteP;
      return { deleted: true };
    },
  );

  // Caller 2: Loser
  const loserPromise = approvals.resume(
    req.requestId,
    async () => {
      loserInValidation();
      await loserCanFinishValidationP;
      return { ok: false as const, reason: 'workspace changed' };
    },
    async () => {
      assert.fail('Loser must not execute');
    },
  );

  // 1. Wait until BOTH callers have read APPROVED and entered validation
  await winnerInValidationP;
  await loserInValidationP;

  // 2. Allow winner to finish validation and claim execution
  winnerCanFinishValidation();
  await winnerInsideExecutorP;

  // Winner is now EXECUTING
  const executingTicket = approvalRepo.get(req.requestId);
  assert.equal(executingTicket?.state, 'EXECUTING');

  // 3. Now let loser finish validation with failure (context changed)
  loserCanFinishValidation();

  // Loser should throw APPROVAL_CONTEXT_CHANGED
  await assert.rejects(loserPromise, (e: any) => e.code === 'APPROVAL_CONTEXT_CHANGED');

  // 4. Verify DB state STAYS 'EXECUTING' and was NOT overwritten to 'CONTEXT_CHANGED'
  const stateDuringWinnerExecution = approvalRepo.get(req.requestId);
  assert.equal(stateDuringWinnerExecution?.state, 'EXECUTING');

  // 5. Finish winner and verify SUCCEEDED
  winnerCanComplete();
  const winnerResult = await winnerPromise;
  assert.deepEqual(winnerResult, { deleted: true });
  assert.equal(executionCount, 1);

  const finalTicket = approvalRepo.get(req.requestId);
  assert.equal(finalTicket?.state, 'SUCCEEDED');

  // Audit records: exactly 1 execution lifecycle, no spurious resume_rejected
  const auditEvents = auditRepo.list().map((r: any) => JSON.parse(r.event_json));
  assert.ok(auditEvents.some((e: any) => e.decision.startsWith('approved')));
  assert.ok(auditEvents.some((e: any) => e.decision === 'resume' && e.result === 'EXECUTING'));
  assert.ok(auditEvents.some((e: any) => e.decision === 'resume' && e.result === 'SUCCEEDED'));
  assert.ok(
    !auditEvents.some((e: any) => e.decision === 'resume_rejected'),
    'No spurious resume_rejected audit event should be recorded',
  );

  // Also test: rejection arriving after winner already finished SUCCEEDED
  // Reset ticket to APPROVED to test this specific case
  const req2 = await approvals.request({
    actor: 'oauth:ChatGPT',
    sessionId: 'ses_2',
    workspaceId: 'ws_1',
    operation: { family: 'files:delete', capability: 'files.delete', risk: 'HIGH', argsHash: 'x' },
    payload: { tool: 'file_delete', args: { path: '/file2.txt' } },
    expectedState: {},
    risk: 'HIGH',
  });
  approvals.approve(req2.requestId, 'once');

  let lateLoserInValidation!: () => void;
  const lateLoserInValidationP = new Promise<void>((r) => {
    lateLoserInValidation = r;
  });
  let lateLoserCanFinishValidation!: () => void;
  const lateLoserCanFinishValidationP = new Promise<void>((r) => {
    lateLoserCanFinishValidation = r;
  });

  const lateLoserPromise = approvals.resume(
    req2.requestId,
    async () => {
      lateLoserInValidation();
      await lateLoserCanFinishValidationP;
      return { ok: false as const, reason: 'workspace changed' };
    },
    async () => assert.fail('Must not execute'),
  );

  await lateLoserInValidationP;

  // Winner executes completely to SUCCEEDED while late loser is still validating
  await approvals.resume(
    req2.requestId,
    async () => ({ ok: true as const }),
    async () => ({ completed: true }),
  );
  assert.equal(approvalRepo.get(req2.requestId)?.state, 'SUCCEEDED');

  // Now let late loser finish validation
  lateLoserCanFinishValidation();
  await assert.rejects(lateLoserPromise, (e: any) => e.code === 'APPROVAL_CONTEXT_CHANGED');

  // Stored state must remain SUCCEEDED
  assert.equal(approvalRepo.get(req2.requestId)?.state, 'SUCCEEDED');

  db.close();
});
