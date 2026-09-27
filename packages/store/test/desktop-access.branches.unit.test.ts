import test from 'node:test';
import assert from 'node:assert/strict';
import { AevraDatabase } from '../src/database.js';
import { DesktopAccessRepository, type NewDesktopAccessRequest } from '../src/desktop-access.js';
import { DesktopAppCatalogRepository } from '../src/desktop-app-catalog.js';
import { HostControlGrantRepository } from '../src/host-control-grants.js';

const T0 = '2026-09-01T00:00:00.000Z';
const LATER = '2026-09-01T00:00:30.000Z';
const EXPIRED = '2026-09-01T01:00:00.000Z';

function req(id: string, extra: Partial<NewDesktopAccessRequest> = {}): NewDesktopAccessRequest {
  return {
    id,
    actor: 'agent',
    sessionId: 'session-1',
    workspaceId: 'ws-1',
    scope: 'workspace',
    requesterIdentity: null,
    windowId: 'win-1',
    targetExecutablePath: 'C:/Apps/sample.exe',
    targetProcessId: 10,
    targetProcessStartedAt: T0,
    hostExecutablePath: 'C:/Apps/host.exe',
    hostWindowId: 'host-win',
    hostProcessId: 20,
    hostProcessStartedAt: T0,
    requestedDuration: 'session',
    expiresAt: '2026-09-01T00:05:00.000Z',
    createdAt: T0,
    updatedAt: T0,
    ...extra,
  };
}

function grant(id: string, sessionId: string | null = 'session-1') {
  return {
    id,
    executablePath: 'C:/Apps/sample.exe',
    pathKey: 'c:/apps/sample.exe',
    displayName: 'Sample',
    createdAt: T0,
    createdBy: 'admin',
    sessionId,
  };
}

test('desktop access: pending requests are deduplicated and host identity round-trips', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new DesktopAccessRepository(db.raw());
  const first = repo.createOrGetPending(req('r1'));
  assert.equal(first.existing, false);
  assert.equal(first.request.requesterIdentity, null);
  const again = repo.createOrGetPending(req('r2'));
  assert.equal(again.existing, true);
  assert.equal(again.request.id, 'r1');

  const host = repo.createOrGetPending(
    req('r3', {
      scope: 'host',
      workspaceId: null,
      windowId: 'win-2',
      requesterIdentity: { kind: 'oauth', key: 'subject-a' },
    }),
  );
  assert.deepEqual(host.request.requesterIdentity, { kind: 'oauth', key: 'subject-a' });
  assert.equal(repo.getRequest('missing'), null);
  assert.deepEqual(
    repo.listPending(LATER).map((r) => r.id),
    ['r1', 'r3'],
  );
  repo.expireRequest('r3', LATER);
  assert.equal(repo.getRequest('r3')?.state, 'EXPIRED');
  assert.deepEqual(repo.listPending(EXPIRED), []);
  assert.equal(repo.getRequest('r1')?.state, 'EXPIRED');
  db.close();
});

test('desktop access: deny handles missing, expired and pending requests', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new DesktopAccessRepository(db.raw());
  assert.equal(repo.denyRequest('missing', 'admin', LATER), null);
  repo.createOrGetPending(req('r1'));
  const denied = repo.denyRequest('r1', 'admin', LATER);
  assert.equal(denied?.state, 'DENIED');
  assert.equal(denied?.decidedBy, 'admin');
  assert.equal(repo.denyRequest('r1', 'admin', LATER), null);

  repo.createOrGetPending(req('r2', { windowId: 'win-9' }));
  assert.equal(repo.denyRequest('r2', 'admin', EXPIRED), null);
  assert.equal(repo.getRequest('r2')?.state, 'EXPIRED');
  db.close();
});

test('desktop access: approve creates or reuses grants per scope', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new DesktopAccessRepository(db.raw());
  assert.equal(repo.approveRequest('missing', 'session', 'admin', LATER, grant('g0')), null);

  repo.createOrGetPending(req('r1'));
  const approved = repo.approveRequest('r1', 'session', 'admin', LATER, grant('g1'))!;
  assert.equal(approved.request.state, 'APPROVED');
  assert.equal(approved.request.decisionScope, 'session');
  assert.equal(approved.grant.scopeKey, 'session:session-1');
  assert.equal(approved.grant.id, 'g1');

  repo.createOrGetPending(req('r2'));
  const reused = repo.approveRequest('r2', 'session', 'admin', LATER, {
    ...grant('g2'),
    displayName: 'Renamed',
  })!;
  assert.equal(reused.grant.id, 'g1');
  assert.equal(reused.grant.displayName, 'Renamed');

  repo.createOrGetPending(req('r3'));
  const persistent = repo.approveRequest('r3', 'persistent', 'admin', LATER, grant('g3'))!;
  assert.equal(persistent.grant.scopeKey, 'persistent');

  repo.createOrGetPending(req('r4'));
  assert.equal(repo.approveRequest('r4', 'session', 'admin', EXPIRED, grant('g4')), null);
  assert.equal(repo.getRequest('r4')?.state, 'EXPIRED');
  assert.equal(repo.approveRequest('r1', 'session', 'admin', LATER, grant('g5')), null);
  db.close();
});

test('desktop grants: save, rename, list and revoke', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new DesktopAccessRepository(db.raw());
  const persistent = repo.saveGrant(grant('p1', null));
  assert.equal(persistent.scopeKey, 'persistent');
  const session = repo.saveGrant(grant('s1', 'session-7'));
  assert.equal(session.scopeKey, 'session:session-7');
  const dup = repo.saveGrant({ ...grant('p2', null), displayName: 'Other' });
  assert.equal(dup.id, 'p1');
  assert.equal(dup.displayName, 'Other');
  repo.renameGrantsForPath('c:/apps/sample.exe', 'Final');
  assert.deepEqual(
    repo.listGrants().map((g) => [g.id, g.displayName]),
    [
      ['p1', 'Final'],
      ['s1', 'Final'],
    ],
  );
  assert.equal(repo.revokeGrant('s1')?.id, 's1');
  assert.equal(repo.revokeGrant('s1'), null);
  assert.deepEqual(
    repo.listGrants().map((g) => g.id),
    ['p1'],
  );
  db.close();
});

test('desktop access transaction rolls back on failure', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new DesktopAccessRepository(db.raw());
  repo.createOrGetPending(req('r1'));
  // A duplicate id with a different window avoids dedupe and violates the primary key.
  assert.throws(() => repo.createOrGetPending(req('r1', { windowId: 'win-x' })));
  // Rollback leaves the connection usable for a new transaction.
  assert.equal(repo.createOrGetPending(req('r2', { windowId: 'win-y' })).existing, false);
  db.close();
});

test('custom app catalog: id handling, upsert by path, find and delete', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new DesktopAppCatalogRepository(db.raw());
  const base = {
    pathKey: 'c:/apps/tool.exe',
    executablePath: 'C:/Apps/tool.exe',
    displayName: 'Tool',
    version: '1.0',
    createdAt: T0,
    updatedAt: T0,
  };
  const blank = repo.saveCustom({ ...base, id: '   ' });
  assert.match(blank.id, /^[0-9a-f-]{36}$/);
  const updated = repo.saveCustom({ ...base, id: blank.id, displayName: 'Tool 2', updatedAt: LATER });
  assert.equal(updated.id, blank.id);
  assert.equal(updated.displayName, 'Tool 2');
  assert.equal(updated.updatedAt, LATER);
  // Unknown id but same path conflicts on path_key and updates the stored row.
  const byPath = repo.saveCustom({ ...base, id: 'fresh-id', version: '2.0' });
  assert.equal(byPath.id, blank.id);
  assert.equal(byPath.version, '2.0');
  const other = repo.saveCustom({ ...base, pathKey: 'c:/apps/b.exe', displayName: 'b app' });
  assert.deepEqual(
    repo.listCustom().map((a) => a.displayName),
    ['b app', 'Tool'],
  );
  assert.equal(repo.findCustomByPath('c:/apps/b.exe')?.id, other.id);
  assert.equal(repo.findCustomByPath('c:/apps/none.exe'), null);
  assert.equal(repo.deleteCustom(other.id)?.id, other.id);
  assert.equal(repo.deleteCustom(other.id), null);
  db.close();
});

test('host control grants: validation, session and persisted revoke, listing', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new HostControlGrantRepository(db.raw());
  assert.throws(
    () => repo.get({ kind: 'oauth', key: '' }, 'desktop.control'),
    /HOST_CONTROL_GRANT_INVALID/,
  );
  assert.throws(
    () => repo.get({ kind: 'bogus' as any, key: 'k' }, 'desktop.control'),
    /HOST_CONTROL_GRANT_INVALID/,
  );
  assert.throws(
    () => repo.get({ kind: 'oauth', key: 'k' }, 'files.write' as any),
    /HOST_CONTROL_GRANT_INVALID/,
  );
  assert.throws(
    () => repo.upsert({ kind: 'oauth', key: 'k' }, 'desktop.control', ''),
    /HOST_CONTROL_GRANT_INVALID/,
  );

  const session = { kind: 'session' as const, key: 'sess-1' };
  assert.equal(repo.revoke(session, 'browser.control'), false);
  repo.upsert(session, 'browser.control', 'admin');
  repo.upsert({ kind: 'session', key: 'sess-2' }, 'browser.control', 'admin');
  assert.equal(repo.list(session).length, 1);
  assert.equal(repo.revoke(session, 'browser.control'), true);
  assert.ok(repo.get(session, 'browser.control')?.revokedAt);
  assert.equal(repo.revoke(session, 'browser.control'), false);

  const oauth = { kind: 'oauth' as const, key: 'subject-1' };
  repo.upsert(oauth, 'desktop.control', 'admin');
  repo.upsert(oauth, 'browser.control', 'owner');
  assert.deepEqual(
    repo.list(oauth).map((g) => [g.capability, g.grantedBy]),
    [
      ['browser.control', 'owner'],
      ['desktop.control', 'admin'],
    ],
  );
  assert.equal(repo.revoke(oauth, 'desktop.control'), true);
  assert.equal(repo.revoke(oauth, 'desktop.control'), false);
  repo.upsert(oauth, 'desktop.control', 'admin');
  assert.equal(repo.get(oauth, 'desktop.control')?.revokedAt, null);
  db.close();
});
