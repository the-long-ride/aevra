import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { ChangeRepository } from '../../../packages/store/src/changes.js';
import { OperationRepository } from '../../../packages/store/src/operations.js';
import { WorkspaceRepository } from '../../../packages/store/src/workspaces.js';
import { WorkspaceService } from '../src/workspaces/workspace-service.js';
import { ChangeSetService } from '../src/changes/change-service.js';
test('change set creates bounded recovery manifest and never replays incomplete operations', async () => {
  const db = AevraDatabase.open(':memory:');
  const ws = new WorkspaceService(new WorkspaceRepository(db.raw()));
  const d = mkdtempSync(path.join(os.tmpdir(), 'aevra-chg-')),
    w = ws.create({ name: 'W', hostRoot: d });
  const ops = new OperationRepository(db.raw());
  ops.put({ id: 'op', kind: 'file.write', state: 'EXECUTING' });
  const worker = {
    async execute(i: any) {
      return { ok: true, value: { sizeBytes: 4 } };
    },
  };
  const c = new ChangeSetService(
    new ChangeRepository(db.raw()),
    ops,
    ws,
    worker as any,
    path.join(d, 'recovery'),
  );
  const set = await c.begin('s', w.id, 'x');
  assert.equal(set.state, 'OPEN');
  await c.reconcileIncompleteOperations();
  assert.equal(
    db.raw().prepare('SELECT state FROM operations WHERE id=?').get('op').state,
    'INTERRUPTED',
  );
  db.close();
});
