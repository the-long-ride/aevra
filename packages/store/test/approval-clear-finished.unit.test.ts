import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../src/database.js';
import { ApprovalRepository } from '../src/approvals.js';

function ticket(id: string, state: string) {
  return {
    id,
    actor: 'oauth:ChatGPT',
    sessionId: 'ses_1',
    workspaceId: 'ws_1',
    operation: { kind: 'files:write', family: 'files:write', capability: 'files.write' },
    payload: { path: 'a.txt' },
    expectedState: {},
    risk: 'MEDIUM' as const,
    state,
    expiresAt: '2026-09-17T12:05:00.000Z',
    createdAt: '2026-09-17T12:00:00.000Z',
  };
}

test('clearFinished keeps live states and removes every other state', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new ApprovalRepository(db.raw());
  const keep = ['PENDING', 'APPROVED', 'EXECUTING'];
  const drop = [
    'DENIED',
    'EXPIRED',
    'SUCCEEDED',
    'FAILED',
    'INTERRUPTED',
    'CONTEXT_CHANGED',
    'CANCELLED',
    'SOME_FUTURE_STATE',
  ];
  for (const state of [...keep, ...drop]) repo.put(ticket(`req_${state}`, state));

  assert.equal(repo.clearFinished(), drop.length);
  assert.deepEqual(
    repo
      .list()
      .map((row: any) => row.state)
      .sort(),
    [...keep].sort(),
  );
  assert.equal(repo.clearFinished(), 0);
  db.close();
});
