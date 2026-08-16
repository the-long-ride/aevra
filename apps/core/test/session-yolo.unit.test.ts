import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { SessionRepository } from '../../../packages/store/src/sessions.js';
import { ALL_CAPABILITIES, CapabilityProfileService } from '../src/policy/capabilities.js';
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
  const manager = new SessionManager(new SessionRepository(db.raw()), profiles);
  return { db, manager };
}

test('connector YOLO overlays every capability and disabling restores the lease', () => {
  const { db, manager } = fixture();
  const session = manager.create({
    subject: 'connector_1',
    actor: 'connector:ChatGPT',
    issuer: 'aevra:connector',
    audience: 'aevra',
    expiresAt: 'x',
  });
  const admitted = manager.admitWorkspace(session.id, 'w', 'read-only');
  assert.equal(admitted.status, 'admitted');
  const original = [...manager.activeLease(session.id)!.capabilities];

  manager.enableYolo(session.id);
  assert.equal(manager.isYolo(session.id), true);
  assert.deepEqual(
    new Set(manager.activeLease(session.id)!.capabilities),
    new Set(ALL_CAPABILITIES),
  );
  assert.equal(manager.list().find((item) => item.id === session.id)?.yolo, true);

  manager.disableYolo(session.id);
  assert.equal(manager.isYolo(session.id), false);
  assert.deepEqual(manager.activeLease(session.id)!.capabilities, original);
  db.close();
});

test('OAuth connector sessions can use YOLO and ordinary actors cannot', () => {
  const { db, manager } = fixture();
  const oauth = manager.create({
    subject: 'oauth_grant_1',
    actor: 'oauth:ChatGPT',
    issuer: 'https://example.test',
    audience: 'https://example.test/mcp',
    expiresAt: 'x',
  });
  assert.equal(manager.enableYolo(oauth.id).enabled, true);

  const ordinary = manager.create({
    subject: 'subject',
    actor: 'alice@example.test',
    issuer: 'https://access.example.test',
    audience: 'aevra',
    expiresAt: 'x',
  });
  assert.throws(() => manager.enableYolo(ordinary.id), /only available for connector sessions/i);

  manager.revoke(oauth.id);
  assert.equal(manager.isYolo(oauth.id), false);
  db.close();
});
