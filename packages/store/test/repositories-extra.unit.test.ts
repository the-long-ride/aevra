import assert from 'node:assert/strict';
import test from 'node:test';
import { ApprovalRepository } from '../src/approvals.js';
import { AuditRepository } from '../src/audit.js';
import { AevraDatabase } from '../src/database.js';
import { OperationRepository } from '../src/operations.js';

test('approval repository put, get, and list', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new ApprovalRepository(db.raw());

  const item1 = repo.put({
    id: 'app1',
    actor: 'oauth:ChatGPT',
    sessionId: 'sess1',
    workspaceId: 'w1',
    operation: { kind: 'command.run' },
    payload: { cmd: 'test' },
    expectedState: { head: 'abc' },
    risk: 'LOW',
    state: 'PENDING',
    expiresAt: '2026-09-01T00:00:00.000Z',
    cancellationReason: 'timeout',
    decisionScope: 'once',
    createdAt: '2026-08-01T00:00:00.000Z',
  });
  assert.equal(item1.id, 'app1');

  const fetched = repo.get('app1');
  assert.equal(fetched?.actor, 'oauth:ChatGPT');
  assert.equal(fetched?.operation?.kind, 'command.run');
  assert.equal(fetched?.cancellationReason, 'timeout');
  assert.equal(fetched?.decisionScope, 'once');

  // Minimal put with defaults
  repo.put({
    id: 'app2',
    actor: 'oauth:Claude',
    sessionId: 'sess2',
    workspaceId: 'w1',
    operation: { kind: 'file.read' },
    risk: 'HIGH',
    state: 'PENDING',
    expiresAt: '2026-09-01T00:00:00.000Z',
  });

  const fetched2 = repo.get('app2');
  assert.equal(fetched2?.id, 'app2');
  assert.deepEqual(fetched2?.expectedState, {});
  assert.equal(fetched2?.cancellationReason, null);

  assert.equal(repo.get('missing'), null);
  assert.equal(repo.list().length, 2);

  db.close();
});

test('operation repository put, updateState, and incomplete', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new OperationRepository(db.raw());

  repo.put({
    id: 'op1',
    sessionId: 'sess1',
    workspaceId: 'w1',
    kind: 'file.write',
    state: 'PREPARING',
    intent: { path: '/a' },
    expectedState: { hash: '1' },
    result: { ok: true },
    createdAt: '2026-08-01T00:00:00.000Z',
  });

  // Minimal put with null defaults
  repo.put({
    id: 'op2',
    kind: 'command.run',
    state: 'EXECUTING',
  });

  assert.equal(repo.incomplete().length, 2);

  repo.updateState('op1', 'COMPLETED', { success: true });
  repo.updateState('op2', 'FAILED');

  assert.equal(repo.incomplete().length, 0);

  db.close();
});

test('audit repository deleteIds, clearWithCheckpoint on empty, and custom class', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new AuditRepository(db.raw());

  // Empty clearWithCheckpoint returns 0
  assert.equal(repo.clearWithCheckpoint(), 0);

  repo.insert({
    id: 'evt1',
    createdAt: new Date().toISOString(),
    eventJson: JSON.stringify({ type: 'test' }),
    previousHash: 'prev1',
    contentHash: 'hash1',
    class: 'security',
  });
  repo.insert({
    id: 'evt2',
    createdAt: new Date().toISOString(),
    eventJson: JSON.stringify({ type: 'test2' }),
    previousHash: 'hash1',
    contentHash: 'hash2',
  });

  assert.equal(repo.list().length, 2);

  repo.deleteIds(['evt1']);
  assert.equal(repo.list().length, 1);
  assert.equal(repo.last()?.id, 'evt2');

  db.close();
});
