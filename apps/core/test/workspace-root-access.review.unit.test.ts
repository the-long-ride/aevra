import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { SessionRepository } from '../../../packages/store/src/sessions.js';
import { WorkspaceRepository } from '../../../packages/store/src/workspaces.js';
import { CapabilityProfileService } from '../src/policy/capabilities.js';
import { SessionManager } from '../src/sessions/session-manager.js';

test('invalidating a workspace root revokes live leases and remembered grants', () => {
  const database = AevraDatabase.open(':memory:');
  try {
    const repo = new SessionRepository(database.raw());
    const workspace = new WorkspaceRepository(database.raw()).create({
      name: 'one',
      hostRoot: 'C:/one',
    });
    const profiles = new CapabilityProfileService(database.raw());
    const sessions = new SessionManager(repo, profiles);
    const session = sessions.create({
      actor: 'oauth:chatgpt',
      subject: 'subject-1',
      connectionId: 'connection-1',
    } as any);

    repo.rememberWorkspaceGrant('subject-1', workspace.id, 'read-only');
    const admitted = sessions.admitWorkspace(session.id, workspace.id, 'read-only');
    assert.equal(admitted.status, 'admitted');
    assert.ok(sessions.leaseForWorkspace(session.id, workspace.id));
    assert.equal(repo.listRememberedWorkspaceGrants('subject-1').length, 1);

    sessions.invalidateWorkspaceAccess(workspace.id);

    assert.equal(sessions.leaseForWorkspace(session.id, workspace.id), null);
    assert.deepEqual(repo.listRememberedWorkspaceGrants('subject-1'), []);
  } finally {
    database.close();
  }
});
