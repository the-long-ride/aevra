import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../src/database.js';
import { WorkspaceRepository } from '../src/workspaces.js';
test('remote workspace view omits hostRoot', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new WorkspaceRepository(db.raw());
  repo.create({ name: 'Voxveil', hostRoot: '/secret/root' });
  const view = repo.listRemote()[0]!;
  assert.equal('hostRoot' in view, false);
  assert.equal(view.name, 'Voxveil');
  db.close();
});
