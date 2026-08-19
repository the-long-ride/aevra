import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { SessionRepository } from '../../../packages/store/src/sessions.js';
import { CapabilityProfileService } from '../src/policy/capabilities.js';
import { SessionManager } from '../src/sessions/session-manager.js';

function fixture() {
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
  const manager = new SessionManager(new SessionRepository(db.raw()), profiles);
  return { db, profiles, manager };
}

test('Core generates fresh session IDs and refreshes lease inactivity', () => {
  const db = AevraDatabase.open(':memory:');
  const profiles = new CapabilityProfileService(db.raw());
  db.raw()
    .prepare(
      "INSERT INTO workspaces(id,name,host_root,created_at,updated_at) VALUES('w','W','/tmp',?,?)",
    )
    .run(new Date().toISOString(), new Date().toISOString());
  profiles.mapActor('a', 'w', 'read-only', 'auto');
  let now = new Date('2026-01-01T00:00:00Z');
  const mgr = new SessionManager(new SessionRepository(db.raw()), profiles, 30 * 60_000, {
    now: () => now,
  });
  const id = { subject: 's', actor: 'a', issuer: 'i', audience: 'x', expiresAt: 'x' };
  const a = mgr.create(id),
    b = mgr.create(id);
  assert.notEqual(a.id, b.id);
  const admitted = mgr.admitWorkspace(a.id, 'w');
  assert.equal(admitted.status, 'admitted');
  const first = (admitted as any).lease.expiresAt;
  now = new Date(now.getTime() + 10 * 60_000);
  mgr.touch(a.id);
  assert.notEqual(mgr.activeLease(a.id)!.expiresAt, first);
  db.close();
});

test('unknown actor workspace requires admission approval', () => {
  const { db, manager } = fixture();
  const s = manager.create({
    subject: 's',
    actor: 'a',
    issuer: 'i',
    audience: 'x',
    expiresAt: 'x',
  });
  assert.equal(manager.admitWorkspace(s.id, 'w').status, 'approval-required');
  db.close();
});

test('OAuth connection workspace grant restores a fresh lease after MCP reconnect', () => {
  const { db, manager } = fixture();
  const identity = {
    subject: 'oauth_grant_one',
    actor: 'oauth:ChatGPT',
    issuer: 'i',
    audience: 'x',
    expiresAt: 'x',
  };
  const first = manager.create(identity);
  const granted = manager.grantConnectionWorkspace(first.id, 'w', 'read-only');
  assert.ok(granted);
  assert.equal(granted.workspaceId, 'w');
  const firstLease = manager.activeLease(first.id);
  assert.ok(firstLease);
  manager.disconnect(first.id);
  const second = manager.create(identity);
  assert.notEqual(second.id, first.id);
  const secondLease = manager.activeLease(second.id);
  assert.ok(secondLease);
  assert.equal(secondLease.workspaceId, 'w');
  assert.notEqual(secondLease.id, firstLease.id);
  assert.ok(secondLease.capabilities.includes('files.read'));
  assert.ok(secondLease.capabilities.includes('files.search'));
  assert.equal(secondLease.capabilities.includes('files.write'), false);
  assert.equal(secondLease.capabilities.includes('commands.run'), false);
  db.close();
});

test('OAuth connection workspace grant does not cross to another authorization subject', () => {
  const { db, manager } = fixture();
  const first = manager.create({
    subject: 'oauth_grant_one',
    actor: 'oauth:ChatGPT',
    issuer: 'i',
    audience: 'x',
    expiresAt: 'x',
  });
  manager.grantConnectionWorkspace(first.id, 'w', 'read-only');
  manager.disconnect(first.id);
  const other = manager.create({
    subject: 'oauth_grant_two',
    actor: 'oauth:ChatGPT',
    issuer: 'i',
    audience: 'x',
    expiresAt: 'x',
  });
  assert.equal(manager.activeLease(other.id), null);
  assert.equal(manager.admitWorkspace(other.id, 'w').status, 'approval-required');
  db.close();
});

test('OAuth connection can remember approvals for multiple workspaces and last active workspace', () => {
  const { db, manager } = fixture();
  const identity = {
    subject: 'oauth_grant_one',
    actor: 'oauth:ChatGPT',
    issuer: 'i',
    audience: 'x',
    expiresAt: 'x',
  };
  const first = manager.create(identity);
  manager.grantConnectionWorkspace(first.id, 'w', 'read-only');
  manager.grantConnectionWorkspace(first.id, 'w2', 'read-only');
  assert.equal(manager.activeLease(first.id)?.workspaceId, 'w2');
  assert.equal(manager.admitWorkspace(first.id, 'w').status, 'admitted');
  assert.equal(manager.activeLease(first.id)?.workspaceId, 'w');
  manager.disconnect(first.id);
  const second = manager.create(identity);
  assert.equal(manager.activeLease(second.id)?.workspaceId, 'w');
  db.close();
});

test('restart invalidation clears OAuth connection workspace grants', () => {
  const { db, manager } = fixture();
  const identity = {
    subject: 'oauth_grant_one',
    actor: 'oauth:ChatGPT',
    issuer: 'i',
    audience: 'x',
    expiresAt: 'x',
  };
  const first = manager.create(identity);
  manager.grantConnectionWorkspace(first.id, 'w', 'read-only');
  manager.invalidateForRestart();
  const second = manager.create(identity);
  assert.equal(manager.activeLease(second.id), null);
  assert.equal(manager.admitWorkspace(second.id, 'w').status, 'approval-required');
  db.close();
});
