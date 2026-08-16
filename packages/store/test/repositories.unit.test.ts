import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../src/database.js';
import { ProcessRepository } from '../src/processes.js';
import { SessionRepository } from '../src/sessions.js';
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

test('managed process rows default old records to unknown terminal state', () => {
  const db = AevraDatabase.open(':memory:');
  const raw = db.raw();
  raw
    .prepare(
      `INSERT INTO managed_processes(id,workspace_id,lifecycle,ownership,helper_pid,helper_started_at,marker,command_json,execution_mode,log_path,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      'proc_old',
      'ws',
      'keep-running',
      'owned',
      123,
      '2026-08-20T00:00:00.000Z',
      'marker',
      JSON.stringify({ executable: 'node', args: [], env: {} }),
      'host',
      '/tmp/proc.log',
      '2026-08-20T00:00:00.000Z',
      '2026-08-20T00:00:00.000Z',
    );
  const record = new ProcessRepository(raw).get('proc_old');
  assert.equal(record.state, 'unknown');
  assert.equal(record.exit_code, null);
  assert.equal(record.finished_at, null);
  db.close();
});

test('managed process status reconciliation preserves ownership and command metadata', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new ProcessRepository(db.raw());
  repo.put({
    id: 'proc_1',
    name: 'Test runner',
    workspaceId: 'ws',
    lifecycle: 'stop-with-aevra',
    ownership: 'owned',
    helperPid: 42,
    helperStartedAt: '2026-08-20T00:00:00.000Z',
    marker: 'marker',
    command: { executable: 'npm', args: ['test'], env: {} },
    executionMode: 'host',
    state: 'running',
  });
  repo.updateStatus({
    processId: 'proc_1',
    pid: 42,
    lifecycle: 'stop-with-aevra',
    startedAt: '2026-08-20T00:00:00.000Z',
    state: 'completed',
    exitCode: 0,
    signal: null,
    finishedAt: '2026-08-20T00:00:02.000Z',
    durationMs: 2000,
  });
  const record = repo.get('proc_1');
  assert.equal(record.name, 'Test runner');
  assert.equal(record.state, 'completed');
  assert.equal(record.exit_code, 0);
  assert.equal(record.ownership, 'owned');
  assert.deepEqual(JSON.parse(record.command_json), {
    executable: 'npm',
    args: ['test'],
    env: {},
  });
  db.close();
});

test('session repository keeps sibling workspace leases valid when one lease is revoked', () => {
  const db = AevraDatabase.open(':memory:');
  const raw = db.raw();
  const now = new Date().toISOString();
  raw
    .prepare(
      "INSERT INTO workspaces(id,name,host_root,created_at,updated_at) VALUES('w1','W1','/tmp/1',?,?)",
    )
    .run(now, now);
  raw
    .prepare(
      "INSERT INTO workspaces(id,name,host_root,created_at,updated_at) VALUES('w2','W2','/tmp/2',?,?)",
    )
    .run(now, now);
  const repo = new SessionRepository(raw);
  repo.create({
    id: 's1',
    actor: 'oauth:ChatGPT',
    subject: 'grant-1',
    createdAt: now,
    lastActivityAt: now,
  });
  repo.saveLease({
    id: 'l1',
    sessionId: 's1',
    workspaceId: 'w1',
    actor: 'oauth:ChatGPT',
    capabilities: ['files.read'],
    expiresAt: now,
  });
  repo.saveLease({
    id: 'l2',
    sessionId: 's1',
    workspaceId: 'w2',
    actor: 'oauth:ChatGPT',
    capabilities: ['files.read'],
    expiresAt: now,
  });

  (repo as any).revokeLease('l1');

  const rows = raw
    .prepare('SELECT id,valid FROM workspace_leases WHERE session_id=? ORDER BY id')
    .all('s1') as Array<{ id: string; valid: number }>;
  assert.deepEqual(
    rows.map((row) => ({ ...row })),
    [
      { id: 'l1', valid: 0 },
      { id: 'l2', valid: 1 },
    ],
  );
  db.close();
});

test('session repository persists remembered OAuth workspace grants', () => {
  const db = AevraDatabase.open(':memory:');
  const raw = db.raw();
  const now = new Date().toISOString();
  raw
    .prepare(
      "INSERT INTO workspaces(id,name,host_root,created_at,updated_at) VALUES('w1','W1','/tmp/1',?,?)",
    )
    .run(now, now);
  const repo = new SessionRepository(raw) as any;

  repo.rememberWorkspaceGrant('oauth-subject', 'w1', 'read-only');

  const reopened = new SessionRepository(raw) as any;
  assert.deepEqual(
    reopened
      .listRememberedWorkspaceGrants('oauth-subject')
      .map((row: Record<string, unknown>) => ({ ...row })),
    [{ subject: 'oauth-subject', workspaceId: 'w1', profileId: 'read-only' }],
  );
  db.close();
});
