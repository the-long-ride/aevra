import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { DesktopAccessRepository } from '../../../packages/store/src/desktop-access.js';
import { DesktopAccessService } from '../src/desktop/desktop-access-service.js';

function identity(overrides: { window?: any; windowInstance?: any; hostApplication?: any } = {}) {
  return {
    window: {
      windowId: 'window-one',
      title: 'Example',
      processName: 'Example.exe',
      executablePath: 'C:\\Apps\\Example.exe',
      ...overrides.window,
    },
    windowInstance: {
      windowId: 'window-one',
      processId: 42,
      processStartedAt: '2026-09-25T00:00:00Z',
      ...overrides.windowInstance,
    },
    ...(overrides.hostApplication ? { hostApplication: overrides.hostApplication } : {}),
  } as any;
}

function harness(opts: { host?: boolean } = {}) {
  const db = AevraDatabase.open(':memory:');
  const repository = new DesktopAccessRepository(db.raw());
  const state = {
    sessions: new Map<string, string>([['ses-one', 'local']]),
    capabilities: ['desktop.control'],
    hostHas: true,
    hostIdentity: { kind: 'session', key: 'ses-one' } as any,
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
      get: (id: string) => (state.sessions.has(id) ? { actor: state.sessions.get(id)! } : null),
      leaseForWorkspace: (_id: string, ws: string) =>
        ws === 'ws-1' ? { capabilities: state.capabilities } : null,
    },
    capabilityRoots: (ws: string) => [{ workspaceId: ws }],
    ...(opts.host === false
      ? {}
      : { hostControlAccess: { has: () => state.hostHas, identity: () => state.hostIdentity } }),
    audit: { append: (entry: any) => audit.push(entry) },
  } as any);
  return { db, repository, access, state, audit, executions };
}

const base = {
  actor: 'local',
  sessionId: 'ses-one',
  workspaceId: 'ws-1' as string | null,
  windowId: 'window-one',
  duration: 'session' as const,
};

const code = (expected: string) => (error: any) => error.code === expected;

test('request validates duration, window binding, and live session state', () => {
  const h = harness();
  const req = (patch: any) => () => h.access.request({ ...base, identity: identity(), ...patch });
  assert.throws(req({ duration: 'forever' }), code('INVALID_REQUEST'));
  assert.throws(req({ windowId: 'other' }), code('DESKTOP_TARGET_CHANGED'));
  assert.throws(req({ sessionId: 'ses-gone' }), code('DESKTOP_ACCESS_SESSION_ENDED'));
  assert.throws(req({ actor: 'someone-else' }), code('DESKTOP_ACCESS_SESSION_ENDED'));
  assert.throws(req({ workspaceId: null }), code('DESKTOP_ACCESS_SESSION_ENDED'));
  assert.throws(req({ workspaceId: 'ws-unknown' }), code('DESKTOP_ACCESS_SESSION_ENDED'));
  h.state.capabilities = ['files.read'];
  assert.throws(req({}), code('DESKTOP_ACCESS_SESSION_ENDED'));
  assert.equal(h.audit.length, 0);
  h.db.close();
});

test('workspace request is recorded, audited, and deduplicated', () => {
  const h = harness();
  const first = h.access.request({ ...base, identity: identity() });
  assert.equal(first.status, 'PENDING');
  assert.equal(first.application, 'Example');
  assert.equal(first.deduplicated, false);
  const again = h.access.request({ ...base, identity: identity() });
  assert.equal(again.requestId, first.requestId);
  assert.equal(again.deduplicated, true);
  assert.deepEqual(
    h.audit.map((entry) => [entry.result, entry.workspaceId]),
    [
      ['PENDING', 'ws-1'],
      ['PENDING_DEDUPLICATED', 'ws-1'],
    ],
  );
  h.db.close();
});

test('executable identity must be an absolute exe with a process name and stable HWND', () => {
  const h = harness();
  const req = (id: any) => () => h.access.request({ ...base, identity: id });
  assert.throws(
    req(identity({ window: { executablePath: undefined } })),
    code('DESKTOP_IDENTITY_UNAVAILABLE'),
  );
  assert.throws(
    req(identity({ window: { executablePath: 'Apps\\Example.exe' } })),
    code('DESKTOP_IDENTITY_UNAVAILABLE'),
  );
  assert.throws(
    req(identity({ window: { executablePath: 'C:\\Apps\\example.txt' } })),
    code('DESKTOP_IDENTITY_UNAVAILABLE'),
  );
  assert.throws(
    req(identity({ window: { processName: '' } })),
    code('DESKTOP_IDENTITY_UNAVAILABLE'),
  );
  assert.throws(
    req(identity({ windowInstance: { windowId: 'window-two' } })),
    code('DESKTOP_TARGET_CHANGED'),
  );
  const unc = h.access.request({
    ...base,
    identity: identity({ window: { executablePath: '//server/share/Tool.exe' } }),
  });
  assert.equal(unc.application, 'Tool');
  h.db.close();
});

test('WebView2 windows require a distinct verified host application', () => {
  const h = harness();
  const webview = {
    processName: 'msedgewebview2.exe',
    executablePath: 'C:\\Runtime\\msedgewebview2.exe',
  };
  const req = (id: any) => () => h.access.request({ ...base, identity: id });
  assert.throws(req(identity({ window: webview })), code('DESKTOP_HOST_UNVERIFIED'));
  const samePid = {
    executablePath: 'C:\\Apps\\Host.exe',
    instance: { windowId: 'host-w', processId: 42, processStartedAt: 't' },
  };
  assert.throws(
    req(identity({ window: webview, hostApplication: samePid })),
    code('DESKTOP_HOST_UNVERIFIED'),
  );
  const badPath = {
    executablePath: 'relative.exe',
    instance: { windowId: 'host-w', processId: 7, processStartedAt: 't' },
  };
  assert.throws(
    req(identity({ window: webview, hostApplication: badPath })),
    code('DESKTOP_HOST_UNVERIFIED'),
  );
  const byPathOnly = {
    processName: 'Shell.exe',
    executablePath: 'C:\\Runtime\\MSEdgeWebView2.exe',
  };
  assert.throws(req(identity({ window: byPathOnly })), code('DESKTOP_HOST_UNVERIFIED'));
  const host = {
    executablePath: 'C:/Apps/Host.exe',
    instance: { windowId: 'host-w', processId: 7, processStartedAt: 't' },
  };
  const ok = h.access.request({
    ...base,
    identity: identity({ window: webview, hostApplication: host }),
  });
  assert.equal(ok.application, 'Host');
  const stored = h.repository.getRequest(ok.requestId)!;
  assert.equal(stored.hostExecutablePath, 'C:\\Apps\\Host.exe');
  assert.equal(stored.hostProcessId, 7);
  h.db.close();
});

test('host-scoped requests require matching host identity and desktop control grant', () => {
  const h = harness();
  const req = () =>
    h.access.request({ ...base, workspaceId: null, scope: 'host', identity: identity() });
  h.state.hostIdentity = null;
  assert.throws(req, code('DESKTOP_ACCESS_SESSION_ENDED'));
  h.state.hostIdentity = { kind: 'session', key: 'ses-one' };
  h.state.hostHas = false;
  assert.throws(req, code('DESKTOP_ACCESS_SESSION_ENDED'));
  h.state.hostHas = true;
  const ok = req();
  assert.equal(ok.status, 'PENDING');
  assert.equal(h.audit[0].workspaceId, undefined);
  assert.equal(h.access.listPending().length, 1);
  h.state.hostIdentity = { kind: 'connection', key: 'ses-one' };
  assert.equal(h.access.listPending().length, 0, 'identity drift expires the pending request');
  assert.equal(h.repository.getRequest(ok.requestId)?.state, 'EXPIRED');
  h.db.close();

  const noHost = harness({ host: false });
  assert.throws(
    () =>
      noHost.access.request({ ...base, workspaceId: null, scope: 'host', identity: identity() }),
    code('DESKTOP_ACCESS_SESSION_ENDED'),
  );
  noHost.db.close();
});
