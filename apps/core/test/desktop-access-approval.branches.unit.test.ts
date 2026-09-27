import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { DesktopAccessRepository } from '../../../packages/store/src/desktop-access.js';
import { DesktopAccessService } from '../src/desktop/desktop-access-service.js';

function identity(instance: Record<string, unknown> = {}, window: Record<string, unknown> = {}) {
  return {
    window: { windowId: 'window-one', title: 'Example', processName: 'Example.exe', executablePath: 'C:\\Apps\\Example.exe', ...window },
    windowInstance: { windowId: 'window-one', processId: 42, processStartedAt: '2026-09-25T00:00:00Z', ...instance },
  } as any;
}

function harness() {
  const db = AevraDatabase.open(':memory:');
  const repository = new DesktopAccessRepository(db.raw());
  const state = {
    sessions: new Set(['ses-one']),
    hostKey: 'ses-one',
    observed: { ok: true, value: identity() } as any,
    onExecute: undefined as undefined | (() => void),
  };
  const audit: any[] = [];
  const executions: any[] = [];
  const access = new DesktopAccessService({
    repository,
    worker: {
      execute: async (input: any) => {
        executions.push(input);
        state.onExecute?.();
        return state.observed;
      },
    },
    sessions: {
      get: (id: string) => (state.sessions.has(id) ? { actor: 'local' } : null),
      leaseForWorkspace: (_id: string, ws: string) => (ws === 'ws-1' ? { capabilities: ['desktop.control'] } : null),
    },
    capabilityRoots: (ws: string) => [{ root: ws }],
    hostControlAccess: { has: () => true, identity: () => ({ kind: 'session', key: state.hostKey }) },
    audit: { append: (entry: any) => audit.push(entry) },
  } as any);
  const request = (patch: Record<string, unknown> = {}) =>
    access.request({ actor: 'local', sessionId: 'ses-one', workspaceId: 'ws-1', windowId: 'window-one', duration: 'session', identity: identity(), ...patch } as any);
  return { db, repository, access, state, audit, executions, request };
}

const code = (expected: string) => (error: any) => error.code === expected;

test('approve rejects bad scopes, unknown and expired requests', async () => {
  const h = harness();
  await assert.rejects(() => h.access.approve('x', 'forever' as any), code('INVALID_REQUEST'));
  await assert.rejects(() => h.access.approve('missing', 'session'), code('DESKTOP_ACCESS_REQUEST_NOT_PENDING'));
  const { requestId } = h.request();
  const stored = h.repository.getRequest(requestId)!;
  h.db.raw().prepare('UPDATE desktop_access_requests SET expires_at=? WHERE id=?').run(new Date(Date.now() - 1000).toISOString(), stored.id);
  await assert.rejects(() => h.access.approve(requestId, 'session'), code('DESKTOP_ACCESS_REQUEST_EXPIRED'));
  assert.equal(h.repository.getRequest(requestId)?.state, 'EXPIRED');
  await assert.rejects(() => h.access.approve(requestId, 'session'), code('DESKTOP_ACCESS_REQUEST_NOT_PENDING'));
  assert.equal(h.executions.length, 0);
  h.db.close();
});

test('approve expires requests whose session ended before or during verification', async () => {
  const h = harness();
  const before = h.request();
  h.state.sessions.clear();
  await assert.rejects(() => h.access.approve(before.requestId, 'session'), code('DESKTOP_ACCESS_SESSION_ENDED'));
  assert.equal(h.repository.getRequest(before.requestId)?.state, 'EXPIRED');
  assert.equal(h.executions.length, 0);

  h.state.sessions.add('ses-one');
  const during = h.request();
  h.state.onExecute = () => h.state.sessions.clear();
  await assert.rejects(() => h.access.approve(during.requestId, 'session'), code('DESKTOP_ACCESS_SESSION_ENDED'));
  assert.equal(h.repository.getRequest(during.requestId)?.state, 'EXPIRED');
  h.db.close();
});

test('worker verification failures expire only for identity-changing codes', async () => {
  const h = harness();
  const first = h.request();
  h.state.observed = { ok: false, error: { code: 'WORKER_UNAVAILABLE', message: 'worker down' } };
  await assert.rejects(() => h.access.approve(first.requestId, 'session'), (e: any) => e.code === 'WORKER_UNAVAILABLE' && e.message === 'worker down');
  assert.equal(h.repository.getRequest(first.requestId)?.state, 'PENDING');
  for (const failure of ['DESKTOP_TARGET_CHANGED', 'DESKTOP_HOST_UNVERIFIED', 'DESKTOP_INPUT_REFUSED']) {
    h.state.observed = { ok: false, error: { code: failure, message: failure } };
    const { requestId } = h.request();
    await assert.rejects(() => h.access.approve(requestId, 'session'), code(failure));
    assert.equal(h.repository.getRequest(requestId)?.state, 'EXPIRED', failure);
  }
  h.db.close();
});

test('approve refuses when the observed binding differs or cannot be read', async () => {
  const h = harness();
  for (const observed of [identity({ processId: 43 }), identity({ processStartedAt: 'later' }), identity({}, { executablePath: 'C:\\Other.exe' }), identity({}, { executablePath: undefined })]) {
    h.state.observed = { ok: true, value: observed };
    const { requestId } = h.request();
    await assert.rejects(() => h.access.approve(requestId, 'persistent'), code('DESKTOP_TARGET_CHANGED'));
    assert.equal(h.repository.getRequest(requestId)?.state, 'EXPIRED');
  }
  h.db.close();
});

test('session approval creates a session grant; persistent approval creates a global grant', async () => {
  const h = harness();
  const first = h.request();
  const session = await h.access.approve(first.requestId, 'session', 'operator');
  assert.equal(session.grant.sessionId, 'ses-one');
  assert.equal(session.grant.displayName, 'Example');
  assert.equal(session.grant.createdBy, 'operator');
  assert.deepEqual(h.executions[0].roots, [{ root: 'ws-1' }]);
  assert.equal(h.executions[0].scope, undefined);
  assert.equal(h.audit.at(-1).decision, 'session');
  assert.equal(h.audit.at(-1).workspaceId, 'ws-1');

  const host = h.request({ workspaceId: null, scope: 'host' });
  const persistent = await h.access.approve(host.requestId, 'persistent');
  assert.equal(persistent.grant.sessionId, undefined);
  assert.deepEqual(h.executions[1].roots, []);
  assert.equal(h.executions[1].workspaceId, '');
  assert.deepEqual(h.executions[1].scope, { kind: 'host-control', capability: 'desktop.control', identity: { kind: 'session', key: 'ses-one' } });
  assert.equal(h.audit.at(-1).workspaceId, undefined);

  assert.equal(h.access.policyGrants('ses-other').length, 1, 'other sessions only see persistent grants');
  assert.equal(h.access.policyGrants('ses-one').length, 2);
  h.db.close();
});

test('concurrent approvals let only one decision win', async () => {
  const h = harness();
  const { requestId } = h.request();
  const results = await Promise.allSettled([h.access.approve(requestId, 'session'), h.access.approve(requestId, 'session')]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  assert.equal(rejected.reason.code, 'DESKTOP_ACCESS_REQUEST_NOT_PENDING');
  h.db.close();
});

test('host identity key drift expires a pending host request', () => {
  const h = harness();
  h.request({ workspaceId: null, scope: 'host' });
  assert.equal(h.access.listPending().length, 1);
  h.state.hostKey = 'another-session';
  assert.equal(h.access.listPending().length, 0);
  h.db.close();
});

test('deny, explicit grants, renames, revocation, and dead-session grant cleanup', async () => {
  const h = harness();
  const { requestId } = h.request();
  assert.equal(h.access.deny(requestId, 'operator').state, 'DENIED');
  assert.equal(h.audit.at(-1).target, 'Example.exe');
  assert.equal(h.audit.at(-1).workspaceId, 'ws-1');
  assert.throws(() => h.access.deny(requestId), code('DESKTOP_ACCESS_REQUEST_NOT_PENDING'));
  const hostRequest = h.request({ workspaceId: null, scope: 'host' });
  h.access.deny(hostRequest.requestId);
  assert.equal(h.audit.at(-1).workspaceId, undefined);

  assert.throws(() => h.access.grantExplicitApp({ executablePath: 'notepad', displayName: 'x' }), code('INVALID_REQUEST'));
  assert.throws(() => h.access.grantExplicitApp({ executablePath: 42 as any, displayName: 'x' }), code('INVALID_REQUEST'));
  const explicit = h.access.grantExplicitApp({ executablePath: 'C:\\Tools\\Editor.EXE', displayName: '   ' });
  assert.equal(explicit.displayName, 'Editor');
  assert.equal(explicit.createdBy, 'admin');
  const named = h.access.grantExplicitApp({ executablePath: 'C:\\Tools\\Viewer.exe', displayName: ' Viewer App ' }, 'operator');
  assert.equal(named.displayName, 'Viewer App');
  h.access.renameGrantsForPath('c:/tools/editor.exe', '  Renamed Editor  ');
  assert.equal(h.access.listGrants().find((g) => g.id === explicit.id)?.displayName, 'Renamed Editor');

  assert.equal(h.access.revokeGrant(named.id, 'operator').id, named.id);
  assert.equal(h.audit.at(-1).result, 'REVOKED');
  assert.throws(() => h.access.revokeGrant(named.id), code('NOT_FOUND'));

  const pending = h.request({ windowId: 'window-one' });
  await h.access.approve(pending.requestId, 'session');
  assert.equal(h.access.listGrants().length, 2);
  h.state.sessions.clear();
  const live = h.access.listGrants();
  assert.deepEqual(live.map((g) => g.id), [explicit.id], 'grants of ended sessions are revoked');
  h.db.close();
});
