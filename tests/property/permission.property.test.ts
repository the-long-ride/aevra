import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../packages/store/src/database.js';
import { PermissionRepository } from '../../packages/store/src/permissions.js';
import { PermissionEngine } from '../../apps/core/src/policy/permissions.js';
test('equal-specificity deny never loses to allow', () => {
  for (let i = 0; i < 50; i++) {
    const db = AevraDatabase.open(':memory:'),
      repo = new PermissionRepository(db.raw()),
      created = new Date().toISOString();
    repo.upsert({
      id: `a${i}`,
      effect: 'allow',
      capability: 'commands.run',
      scope: 'workspace',
      workspaceId: 'w',
      matcher: 'npm:test',
      createdAt: created,
    });
    repo.upsert({
      id: `d${i}`,
      effect: 'deny',
      capability: 'commands.run',
      scope: 'workspace',
      workspaceId: 'w',
      matcher: 'npm:test',
      createdAt: created,
    });
    assert.equal(
      new PermissionEngine(repo).decide({
        capability: 'commands.run',
        matcher: 'npm:test',
        workspaceId: 'w',
        actor: 'a',
        sessionId: 's',
        risk: 'MEDIUM',
      }).outcome,
      'deny',
    );
    db.close();
  }
});
