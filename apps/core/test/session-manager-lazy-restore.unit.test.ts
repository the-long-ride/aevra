import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { SessionRepository } from '../../../packages/store/src/sessions.js';
import { CapabilityProfileService } from '../src/policy/capabilities.js';
import { SessionManager } from '../src/sessions/session-manager.js';

function countingFixture() {
  const db = AevraDatabase.open(':memory:');
  const profiles = new CapabilityProfileService(db.raw());
  const now = new Date().toISOString();
  db.raw()
    .prepare(
      "INSERT INTO workspaces(id,name,host_root,created_at,updated_at) VALUES('w','W','/tmp',?,?)",
    )
    .run(now, now);
  db.raw()
    .prepare(
      "INSERT INTO workspaces(id,name,host_root,created_at,updated_at) VALUES('w2','W2','/tmp/2',?,?)",
    )
    .run(now, now);
  const repo = new SessionRepository(db.raw());
  let saveLeaseCalls = 0;
  const save = repo.saveLease.bind(repo);
  (repo as any).saveLease = (lease: any) => {
    saveLeaseCalls += 1;
    return save(lease);
  };
  return { db, manager: new SessionManager(repo, profiles), calls: () => saveLeaseCalls };
}

const lazyIdentity = {
  subject: 'oauth_grant_lazy',
  actor: 'oauth:ChatGPT',
  issuer: 'i',
  audience: 'x',
  expiresAt: 'x',
};

function rememberedReconnect(fx: ReturnType<typeof countingFixture>) {
  const first = fx.manager.create(lazyIdentity);
  fx.manager.grantConnectionWorkspace(first.id, 'w', 'read-only');
  fx.manager.grantConnectionWorkspace(first.id, 'w2', 'read-only');
  fx.manager.disconnect(first.id);
}

test('reconnecting does not admit remembered workspace leases until they are first used', () => {
  const fx = countingFixture();
  rememberedReconnect(fx);

  const before = fx.calls();
  const second = fx.manager.create(lazyIdentity);
  assert.equal(fx.calls(), before, 'creating a session must not admit remembered leases');

  assert.deepEqual(
    fx.manager
      .leases(second.id)
      .map((lease) => lease.workspaceId)
      .sort(),
    ['w', 'w2'],
  );
  assert.ok(fx.calls() > before, 'first lease access should admit the remembered workspaces');
  fx.db.close();
});

test('remembered workspaces are restored once no matter how often leases are read', () => {
  const fx = countingFixture();
  rememberedReconnect(fx);

  const second = fx.manager.create(lazyIdentity);
  fx.manager.leases(second.id);
  const afterFirstUse = fx.calls();

  fx.manager.leases(second.id);
  fx.manager.leases(second.id);
  fx.manager.activeLease(second.id);
  fx.manager.leaseForWorkspace(second.id, 'w');
  assert.equal(fx.calls(), afterFirstUse, 'restore must not repeat on subsequent lease reads');
  fx.db.close();
});
