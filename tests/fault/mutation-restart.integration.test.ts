import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../packages/store/src/database.js';
import { OperationRepository } from '../../packages/store/src/operations.js';
test('restart reconciliation input is discoverable but never auto replayed', () => {
  const db = AevraDatabase.open(':memory:'),
    repo = new OperationRepository(db.raw());
  repo.put({
    id: 'op1',
    sessionId: 's',
    workspaceId: 'w',
    kind: 'file.write',
    state: 'EXECUTING',
    intent: { path: '/a' },
    expectedState: { beforeHash: 'x' },
  });
  const rows = repo.incomplete();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, 'EXECUTING');
  assert.equal((rows[0] as any).replayed, undefined);
  db.close();
});
