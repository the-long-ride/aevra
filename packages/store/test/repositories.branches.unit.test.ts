import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { AevraDatabase } from '../src/database.js';
import { ApprovalRepository } from '../src/approvals.js';
import { AuditRepository } from '../src/audit.js';
import { ConnectorRepository } from '../src/connectors.js';
import { ControlPlanRepository } from '../src/control-plans.js';
import { applyMigrations, migrations } from '../src/migrations.js';
import { OperationRepository } from '../src/operations.js';
import { PermissionRepository } from '../src/permissions.js';
import { SessionRepository } from '../src/sessions.js';
import { SettingsRepository } from '../src/settings.js';
import { WorkspaceRepository } from '../src/workspaces.js';

const open = () => AevraDatabase.open(':memory:');

test('approvals: host scope stores identity and legacy operation JSON is tolerated', () => {
  const db = open();
  const repo = new ApprovalRepository(db.raw());
  repo.put({
    id: 'a1',
    actor: 'agent',
    sessionId: 's1',
    workspaceId: 'ws-ignored',
    scope: 'host',
    identity: { kind: 'oauth', key: 'subject-1' },
    operation: { kind: 'desktop' },
    risk: 'HIGH',
    state: 'APPROVED',
    expiresAt: '2999-01-01T00:00:00.000Z',
  });
  const got = repo.get('a1')!;
  assert.equal(got.workspaceId, null);
  assert.deepEqual(got.identity, { kind: 'oauth', key: 'subject-1' });
  assert.equal(got.connectionSubject, undefined);
  assert.equal(got.payload, undefined);
  assert.deepEqual(got.expectedState, {});

  db.raw().prepare('UPDATE pending_approvals SET operation_json=? WHERE id=?').run('{"k":1}', 'a1');
  assert.deepEqual(repo.get('a1')!.operation, { k: 1 });
  assert.equal(repo.get('missing'), null);

  assert.equal(repo.transitionContextChanged('a1', '2026-09-01T00:00:00.000Z'), true);
  assert.equal(repo.get('a1')!.state, 'CONTEXT_CHANGED');
  assert.equal(repo.transitionContextChanged('a1', '2026-09-01T00:00:00.000Z'), false);
  db.close();
});

test('approvals: workspace scope keeps workspace and connection fallback id', () => {
  const db = open();
  const repo = new ApprovalRepository(db.raw());
  repo.put({
    id: 'a2',
    actor: 'agent',
    sessionId: 's1',
    workspaceId: 'ws-1',
    connectionId: 'conn-1',
    operation: { kind: 'file' },
    risk: 'LOW',
    state: 'PENDING',
    expiresAt: '2999-01-01T00:00:00.000Z',
  });
  const got = repo.get('a2')!;
  assert.equal(got.scope, 'workspace');
  assert.equal(got.workspaceId, 'ws-1');
  assert.equal(got.identity, undefined);
  assert.equal(got.connectionSubject, 'conn-1');
  db.close();
});

test('audit: default class, checkpoints and clearing', () => {
  const db = open();
  const repo = new AuditRepository(db.raw());
  assert.equal(repo.checkpoint(), undefined);
  assert.equal(repo.clearWithCheckpoint(), 0);
  repo.insert({ id: 'e1', createdAt: 't', eventJson: '{}', previousHash: 'p0', contentHash: 'h1' });
  repo.insert({ id: 'e2', createdAt: 't', eventJson: '{}', previousHash: 'h1', contentHash: 'h2', class: 'security' });
  assert.deepEqual(
    repo.list().map((r) => r.class),
    ['normal', 'security'],
  );
  assert.equal(repo.clearWithCheckpoint(), 2);
  const cp = repo.checkpoint();
  assert.equal(cp.previous_hash, 'h2');
  assert.equal(cp.event_id, 'e2');
  repo.setCheckpoint('h9', null);
  assert.equal(repo.checkpoint().event_id, null);
  db.close();
});

test('connectors: bindings, activity and TTL checks', () => {
  const db = open();
  const repo = new ConnectorRepository(db.raw());
  const plain = repo.create('plain');
  const bound = repo.create({ name: 'bound', workspaceId: 'ws-1', profileCap: 'reader' });
  const expired = repo.create({ name: 'old', expiresAt: '2000-01-01T00:00:00.000Z' });
  assert.deepEqual(repo.getBindings(plain.connector.id), { workspaceId: null, profileCap: null });
  assert.deepEqual(repo.getBindings(bound.connector.id), { workspaceId: 'ws-1', profileCap: 'reader' });
  assert.equal(repo.getBindings('con_missing'), null);
  assert.equal(repo.isActive(plain.connector.id), true);
  assert.equal(repo.isActive(expired.connector.id), false);
  assert.equal(repo.isActive('con_missing'), false);
  assert.equal(repo.findByToken(expired.token), null);
  assert.equal(repo.findByToken('unknown value'), null);
  assert.equal(repo.rotate('con_missing'), null);
  db.close();
});

test('control plans: mode projection, status updates, finish and digest key validation', () => {
  const db = open();
  const repo = new ControlPlanRepository(db.raw());
  const base = { owner: 'o', digest: 'd', status: 'running', createdAt: 't', updatedAt: 't' };
  const iso = repo.claim({ ...base, planId: 'p1', requestId: 'r1', mode: 'isolated' });
  assert.equal(iso.record.mode, 'isolated');
  assert.equal(iso.record.result, undefined);
  assert.equal(repo.get('o', 'nope'), undefined);
  assert.equal(repo.updateStatus('o', 'p1', 'cancelling', true), true);
  assert.equal(repo.get('o', 'p1')!.cancelled, true);
  assert.equal(repo.updateStatus('o', 'nope', 'x'), false);
  assert.equal(repo.finish('o', 'p1', 'cancelled', { ok: false } as any, true), true);
  const done = repo.get('o', 'p1')!;
  assert.equal(done.cancelled, true);
  assert.deepEqual(done.result, { ok: false });
  // Duplicate plan id with a new request id violates the key and rolls back.
  assert.throws(() => repo.claim({ ...base, planId: 'p1', requestId: 'r2', mode: 'sharedSemantic' }));
  assert.equal(repo.claim({ ...base, planId: 'p2', requestId: 'r3', mode: 'sharedSemantic' }).existing, false);

  db.raw()
    .prepare('INSERT INTO settings(key,value_json,revision) VALUES(?,?,1)')
    .run('control.plan.digestKey.v1', JSON.stringify('short'));
  assert.throws(() => repo.digestKey(), /Invalid persisted control-plan digest key/);
  db.close();
});

test('database: table column names are validated', () => {
  const db = open();
  assert.throws(() => db.tableColumns('settings; DROP'), /Invalid table/);
  assert.ok(db.tableColumns('settings').includes('value_json'));
  assert.deepEqual(db.integrityCheck(), { ok: true });
  db.close();
});

test('migrations: a failing migration is rolled back and not recorded', () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec(
    'CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL)',
  );
  const insert = raw.prepare('INSERT INTO schema_migrations VALUES(?,?,?)');
  for (const m of migrations) if (m.version !== 2) insert.run(m.version, m.name, 't');
  raw.exec('CREATE TABLE permission_rules(id TEXT, session_id TEXT)');
  assert.throws(() => applyMigrations(raw), /duplicate column/i);
  assert.equal(raw.prepare('SELECT 1 FROM schema_migrations WHERE version=2').get(), undefined);
  raw.close();
});

test('operations: projection, state mapping, resolver and bounded listing', () => {
  const db = open();
  const repo = new OperationRepository(db.raw());
  repo.put({ id: 'orphan', kind: 'file', state: 'QUEUED' });
  assert.equal(repo.getById('orphan'), null);
  assert.equal(repo.getById('missing'), null);
  repo.setConnectionResolver((sid) => (sid === 's1' ? 'conn-1' : undefined));
  const states = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED', 'EXECUTING', 'PREPARING'];
  states.forEach((state, i) =>
    repo.put({ id: `op${i}`, sessionId: 's1', workspaceId: 'ws', kind: 'k', state, result: { i } }),
  );
  repo.put({ id: 'unresolved', sessionId: 's2', kind: 'k', state: 'QUEUED' });
  assert.equal(repo.getById('unresolved'), null);
  assert.deepEqual(
    states.map((_, i) => repo.getById(`op${i}`)!.state),
    ['SUCCEEDED', 'FAILED', 'CANCELLED', 'CANCELLED', 'RUNNING', 'QUEUED'],
  );
  const op0 = repo.getById('op0')!;
  assert.equal(op0.sessionId, 's1');
  assert.equal(op0.workspaceId, 'ws');
  assert.deepEqual(op0.result, { i: 0 });
  db.raw().prepare('UPDATE operations SET result_json=? WHERE id=?').run('not json', 'op1');
  assert.equal(repo.getById('op1')!.result, undefined);
  repo.updateState('op2', 'FAILED');
  assert.equal('result' in repo.getById('op2')!, false);
  repo.put({ id: 'direct', connectionId: 'conn-1', kind: 'k', state: 'QUEUED' });
  assert.equal(repo.getById('direct')!.sessionId, undefined);
  assert.equal(repo.listByConnection('conn-1').length, 7);
  assert.equal(repo.listByConnection('conn-1', Number.NaN).length, 7);
  assert.equal(repo.listByConnection('conn-1', 0).length, 1);
  assert.equal(repo.listByConnection('conn-1', 2.9).length, 2);
  assert.equal(repo.attachSession('direct', 's9'), true);
  assert.equal(repo.getById('direct')!.sessionId, 's9');
  assert.equal(repo.attachSession('missing', 's9'), false);
  db.close();
});

test('permissions: snake_case input, predicate versioning and batch rollback', () => {
  const db = open();
  const repo = new PermissionRepository(db.raw());
  const base = { effect: 'allow', capability: 'files.read', scope: 'workspace', matcher: '*' };
  repo.upsert({ ...base, id: 'p1', predicate: { path: 'src' }, workspace_id: 'ws', session_id: 's' });
  const p1 = repo.get('p1');
  assert.equal(p1.version, 2);
  assert.equal(p1.predicate_json, '{"path":"src"}');
  assert.equal(p1.workspace_id, 'ws');
  assert.equal(p1.session_id, 's');
  repo.upsert({ ...base, id: 'p2', created_at: 'c', last_used_at: 'l', expires_at: 'e' });
  const p2 = repo.get('p2');
  assert.equal(p2.version, 1);
  assert.equal(p2.predicate_json, null);
  assert.deepEqual([p2.created_at, p2.last_used_at, p2.expires_at], ['c', 'l', 'e']);
  assert.equal(repo.get('missing'), null);
  assert.throws(() => repo.upsertMany([{ ...base, id: 'p3' }, { ...base, id: 'p4', effect: undefined }]));
  assert.equal(repo.get('p3'), null);
  db.close();
});

test('sessions: leases and remembered grants lifecycle', () => {
  const db = open();
  const repo = new SessionRepository(db.raw());
  const raw = db.raw();
  const valid = (id: string) => (raw.prepare('SELECT valid FROM sessions WHERE id=?').get(id) as any).valid;
  const lease = (id: string) =>
    (raw.prepare('SELECT valid FROM workspace_leases WHERE id=?').get(id) as any).valid;
  const workspaces = new WorkspaceRepository(raw);
  const [w1, w2, w3] = ['w1', 'w2', 'w3'].map((name) => workspaces.create({ name, hostRoot: '/tmp/' + name }).id) as [string, string, string];
  for (const id of ['s1', 's2']) repo.create({ id, actor: 'a', subject: 'sub', createdAt: 't', lastActivityAt: 't' });
  const mk = (id: string, sessionId: string, workspaceId: string) =>
    repo.saveLease({ id, sessionId, workspaceId, actor: 'a', capabilities: [], expiresAt: 't' });
  mk('l1', 's1', w1);
  mk('l2', 's2', w2);
  mk('l3', 's2', w3);
  repo.detach('s1');
  assert.equal(valid('s1'), 0);
  assert.equal(lease('l1'), 1);
  repo.revoke('s1');
  assert.equal(lease('l1'), 0);
  repo.revokeWorkspaceLeases(w2);
  assert.equal(lease('l2'), 0);
  assert.equal(lease('l3'), 1);
  repo.invalidateAll();
  assert.equal(valid('s2'), 0);
  assert.equal(lease('l3'), 0);

  repo.rememberWorkspaceGrant('sub', w1, 'reader');
  repo.rememberWorkspaceGrant('sub', w2, 'writer');
  assert.equal(repo.forgetWorkspaceGrant('sub', w1), true);
  assert.equal(repo.forgetWorkspaceGrant('sub', w1), false);
  repo.forgetWorkspaceGrants(w2);
  assert.deepEqual(repo.listRememberedWorkspaceGrants('sub'), []);
  db.close();
});

test('settings: fallback, set and revision counting', () => {
  const db = open();
  const repo = new SettingsRepository(db.raw());
  assert.deepEqual(repo.get('sample.key', { d: 1 }), { d: 1 });
  assert.equal(repo.revision('sample.key'), 0);
  repo.set('sample.key', { v: 1 });
  repo.set('sample.key', { v: 2 });
  assert.deepEqual(repo.get('sample.key', null), { v: 2 });
  assert.equal(repo.revision('sample.key'), 2);
  db.close();
});

test('workspaces: update, lookup, mounts and deletion', () => {
  const db = open();
  const repo = new WorkspaceRepository(db.raw());
  const ws = repo.create({ name: 'Alpha', hostRoot: '/tmp/alpha' });
  assert.equal(ws.description, '');
  assert.throws(() => repo.update('missing', { name: 'x' }), /workspace not found/);
  const next = repo.update(ws.id, { description: 'described' });
  assert.equal(next.name, 'Alpha');
  assert.equal(repo.get(ws.id)?.description, 'described');
  assert.equal(repo.getByName('ALPHA')?.id, ws.id);
  assert.equal(repo.getByName('beta'), null);
  assert.equal(repo.get('missing'), null);
  const mount = repo.addMount(ws.id, {
    logicalPath: '/ext',
    hostRoot: '/tmp/ext',
    capabilities: ['files.read'] as any,
  });
  const mounts = repo.listMounts(ws.id);
  assert.equal(mounts.length, 1);
  assert.deepEqual(mounts[0]!.capabilities, ['files.read']);
  assert.equal(mounts[0]!.sensitivityPolicyId, null);
  repo.deleteMount(mount.id);
  assert.deepEqual(repo.listMounts(ws.id), []);
  repo.delete(ws.id);
  assert.deepEqual(repo.listRemote(), []);
  db.close();
});
