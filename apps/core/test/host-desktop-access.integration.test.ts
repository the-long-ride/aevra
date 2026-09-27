import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { DesktopAccessRepository } from '../../../packages/store/src/desktop-access.js';
import { DesktopAccessService } from '../src/desktop/desktop-access-service.js';

const identity = {
  window: {
    windowId: 'window-one',
    title: 'Example',
    processName: 'Example.exe',
    executablePath: 'C:\\Example.exe',
  },
  windowInstance: {
    windowId: 'window-one',
    processId: 42,
    processStartedAt: '2026-09-25T00:00:00Z',
  },
};

test('desktop access request persists a host scope and expires when host grant is revoked', () => {
  const db = AevraDatabase.open(':memory:');
  let granted = true;
  const access = new DesktopAccessService({
    repository: new DesktopAccessRepository(db.raw()),
    worker: { execute: async () => ({ ok: true, value: identity }) },
    sessions: { get: () => ({ actor: 'local' }), leaseForWorkspace: () => null },
    capabilityRoots: () => [],
    hostControlAccess: {
      has: () => granted,
      identity: () => ({ kind: 'session', key: 'ses-one' }),
    },
  } as any);
  const request = access.request({
    actor: 'local',
    sessionId: 'ses-one',
    workspaceId: null,
    scope: 'host',
    windowId: 'window-one',
    duration: 'session',
    identity,
  } as any);
  assert.equal(request.status, 'PENDING');
  const stored = new DesktopAccessRepository(db.raw()).getRequest(request.requestId)!;
  assert.equal(stored.workspaceId, null);
  assert.equal(stored.scope, 'host');
  assert.deepEqual(stored.requesterIdentity, { kind: 'session', key: 'ses-one' });
  assert.equal(access.listPending().length, 1);
  granted = false;
  assert.equal(access.listPending().length, 0);
  db.close();
});
