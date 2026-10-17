import assert from 'node:assert/strict';
import test from 'node:test';
import { summariseTicket } from '../src/result-shaper/approval.js';

const base = {
  id: 'approval-2',
  state: 'CANCELLED',
  risk: 'LOW',
  workspaceId: 'ws-1',
  expiresAt: '2026-10-07T12:00:00.000Z',
  operation: { summary: 'run build' },
};

test('the summary keeps why a ticket ended and which scope decided it', () => {
  const summary = summariseTicket({
    ...base,
    decisionScope: 'connection',
    cancellationReason: 'cancelled by operator',
  }) as any;
  assert.equal(summary.decisionScope, 'connection');
  assert.equal(summary.cancellationReason, 'cancelled by operator');
});

test('absent reason fields are not added', () => {
  const summary = summariseTicket(base) as any;
  assert.equal('cancellationReason' in summary, false);
  assert.equal('decisionScope' in summary, false);
});

test('a capped summary does not end on half of a surrogate pair', () => {
  const text = `${'a'.repeat(198)}\u{1F600}bbb`;
  const summary = summariseTicket({ ...base, operation: { summary: text } }) as any;
  assert.equal(summary.summary, `${'a'.repeat(198)}…`);
});
