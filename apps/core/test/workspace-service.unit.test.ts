import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { WorkspaceRepository } from '../../../packages/store/src/workspaces.js';
import { WorkspaceService } from '../src/workspaces/workspace-service.js';
test('remote views omit host roots and mounts expose logical paths only', () => {
  const db = AevraDatabase.open(':memory:');
  const s = new WorkspaceService(new WorkspaceRepository(db.raw()));
  const w = s.create({ name: 'V', hostRoot: '/private/v' });
  const mount = s.addMount(w.id, {
    logicalPath: '/external/sdk',
    hostRoot: '/private/sdk',
    capabilities: ['files.read'],
  });
  assert.equal('hostRoot' in s.listRemote()[0]!, false);
  assert.equal('hostRoot' in s.listMountsRemote(w.id)[0]!, false);

  assert.equal(s.listLocal().length, 1);
  assert.equal(s.getLocal('V')?.id, w.id);
  assert.equal(s.getLocal(w.id)?.name, 'V');

  const roots = s.capabilityRoots(w.id);
  assert.equal(roots.length, 2);
  assert.throws(() => s.capabilityRoots('unknown-id'), /workspace not found/);

  assert.equal(s.listMountsLocal(w.id).length, 1);
  s.deleteMount(mount.id);
  assert.equal(s.listMountsLocal(w.id).length, 0);

  s.update(w.id, { name: 'V2' });
  assert.equal(s.getLocal(w.id)?.name, 'V2');

  s.delete(w.id);
  assert.equal(s.listLocal().length, 0);

  db.close();
});
