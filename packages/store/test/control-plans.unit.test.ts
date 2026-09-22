import assert from 'node:assert/strict';
import test from 'node:test';
import { ControlPlanRepository } from '../src/control-plans.js';
import { AevraDatabase } from '../src/database.js';

test('control plan claims are owner/request idempotent and do not store raw action values', () => {
  const db = AevraDatabase.open(':memory:');
  try {
    const repo = new ControlPlanRepository(db.raw());
    const input = {
      planId: 'plan_1',
      owner: 'connection:workspace',
      requestId: 'req_1',
      digest: 'digest-1',
      mode: 'sharedSemantic' as const,
      status: 'running',
      createdAt: '2026-09-22T00:00:00.000Z',
      updatedAt: '2026-09-22T00:00:00.000Z',
    };
    assert.equal(repo.claim(input).existing, false);
    assert.equal(repo.claim({ ...input, planId: 'plan_2' }).record.planId, 'plan_1');

    repo.recordStep({
      planId: 'plan_1',
      stepId: 'save',
      attemptId: 'attempt_1',
      action: 'invoke',
      dispatchState: 'notDispatched',
      status: 'validating',
    });
    const row = db
      .raw()
      .prepare('SELECT * FROM control_plan_steps WHERE plan_id=?')
      .get('plan_1') as any;
    assert.equal(row.action, 'invoke');
    assert.equal('value' in row, false);
  } finally {
    db.close();
  }
});

test('control plan digest key is stable for the same database', () => {
  const db = AevraDatabase.open(':memory:');
  try {
    const first = new ControlPlanRepository(db.raw()).digestKey().toString('hex');
    const second = new ControlPlanRepository(db.raw()).digestKey().toString('hex');
    assert.equal(first, second);
    assert.equal(first.length, 64);
  } finally {
    db.close();
  }
});

test('terminal result summaries survive repository reconstruction without raw action values', () => {
  const db = AevraDatabase.open(':memory:');
  try {
    const repo = new ControlPlanRepository(db.raw());
    repo.claim({
      planId: 'plan_1',
      owner: 'owner',
      requestId: 'req_1',
      digest: 'digest',
      mode: 'sharedSemantic',
      status: 'running',
      createdAt: '2026-09-22T00:00:00.000Z',
      updatedAt: '2026-09-22T00:00:00.000Z',
    });
    repo.finish('owner', 'plan_1', 'completed', {
      planId: 'plan_1',
      status: 'completed',
      steps: [{ id: 'save', status: 'succeeded', postcondition: 'matched' }],
    });
    const recovered = new ControlPlanRepository(db.raw()).get('owner', 'plan_1');
    assert.equal(recovered?.result?.status, 'completed');
    assert.deepEqual(recovered?.result?.steps, [
      { id: 'save', status: 'succeeded', postcondition: 'matched' },
    ]);
  } finally {
    db.close();
  }
});

test('restart reconciliation makes incomplete control plans unknown instead of replayable', () => {
  const db = AevraDatabase.open(':memory:');
  try {
    const repo = new ControlPlanRepository(db.raw());
    repo.claim({
      planId: 'plan_1',
      owner: 'owner',
      requestId: 'req_1',
      digest: 'digest',
      mode: 'sharedSemantic',
      status: 'running',
      createdAt: '2026-09-22T00:00:00.000Z',
      updatedAt: '2026-09-22T00:00:00.000Z',
    });
    assert.equal(repo.reconcileIncomplete(), 1);
    assert.equal(repo.get('owner', 'plan_1')?.status, 'unknown');
  } finally {
    db.close();
  }
});
