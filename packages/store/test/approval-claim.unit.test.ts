import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../src/database.js';
import { ApprovalRepository } from '../src/approvals.js';

test('approval claim and transition serialize execution atomically', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new ApprovalRepository(db.raw());
  const now = '2026-09-17T12:00:00.000Z';
  const expiresAt = '2026-09-17T12:05:00.000Z';

  const ticket = {
    id: 'req_claim_1',
    actor: 'oauth:ChatGPT',
    sessionId: 'ses_1',
    connectionId: 'conn_1',
    connectionSubject: 'conn_1',
    workspaceId: 'ws_1',
    operation: { kind: 'files:write', family: 'files:write', capability: 'files.write' },
    payload: { path: 'a.txt' },
    expectedState: {},
    risk: 'MEDIUM' as const,
    state: 'APPROVED' as const,
    expiresAt,
    createdAt: now,
  };

  repo.put(ticket);

  const retrieved = repo.get(ticket.id);
  assert.equal(retrieved?.id, ticket.id);
  assert.equal(retrieved?.connectionId, 'conn_1');
  assert.equal(retrieved?.state, 'APPROVED');

  // First claim succeeds
  const firstClaim = repo.claimExecution(ticket.id, now);
  assert.equal(firstClaim, true, 'First claim must succeed');

  const inFlight = repo.get(ticket.id);
  assert.equal(inFlight?.state, 'EXECUTING');

  // Second concurrent claim fails
  const secondClaim = repo.claimExecution(ticket.id, now);
  assert.equal(secondClaim, false, 'Second claim must fail because state is already EXECUTING');

  // Transition to SUCCEEDED succeeds from EXECUTING
  const transitionOk = repo.transitionExecution(ticket.id, 'SUCCEEDED', now);
  assert.equal(transitionOk, true, 'Transition to SUCCEEDED must succeed from EXECUTING');

  const finished = repo.get(ticket.id);
  assert.equal(finished?.state, 'SUCCEEDED');

  // Claiming a SUCCEEDED ticket fails
  const claimAfterSuccess = repo.claimExecution(ticket.id, now);
  assert.equal(claimAfterSuccess, false, 'Claiming a finished ticket must fail');

  // Overwriting terminal state via transitionExecution fails
  const overwriteFailed = repo.transitionExecution(ticket.id, 'FAILED', now);
  assert.equal(overwriteFailed, false, 'Overwriting terminal state must fail');

  db.close();
});

test('claiming an expired ticket fails', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new ApprovalRepository(db.raw());
  const now = '2026-09-17T12:00:00.000Z';
  const pastExpires = '2026-09-17T11:59:59.000Z';

  const ticket = {
    id: 'req_claim_expired',
    actor: 'oauth:ChatGPT',
    sessionId: 'ses_1',
    workspaceId: 'ws_1',
    operation: { kind: 'files:write' },
    risk: 'LOW' as const,
    state: 'APPROVED' as const,
    expiresAt: pastExpires,
    createdAt: now,
  };

  repo.put(ticket);
  const claimed = repo.claimExecution(ticket.id, now);
  assert.equal(claimed, false, 'Expired approval claim must fail');

  db.close();
});
