import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isTicketAuthorizedForSession,
  maxRisk,
  resolveWorkspaceLease,
  sameConnection,
  sessionLeases,
  verifyTicketAuthority,
  workspaceRoot,
} from '../src/service-helpers.js';

const WORKSPACES: Record<string, any> = {
  w1: { id: 'w1', name: 'One', description: 'd1', hostRoot: '/one' },
  One: { id: 'w1', name: 'One', description: 'd1', hostRoot: '/one' },
  w2: { id: 'w2', name: 'Two', description: 'd2', hostRoot: '/two' },
  Two: { id: 'w2', name: 'Two', description: 'd2', hostRoot: '/two' },
};

function ctx(overrides: any = {}) {
  const session = { id: 's1', actor: overrides.actor ?? 'oauth:ChatGPT' };
  const lease = { workspaceId: 'w1', capabilities: overrides.capabilities ?? ['files.read'] };
  return {
    sessions: {
      get: (id: string) => (id === 's1' ? session : null),
      activeLease: () => lease,
      leases: () => [lease],
      leaseForWorkspace: (_s: string, id: string) => (id === 'w1' ? lease : null),
      connectionIdentity: () => overrides.identity ?? null,
      ...overrides.sessions,
    },
    workspaces: {
      getLocal: (id: string) => WORKSPACES[id] ?? null,
      listRemote: () => [WORKSPACES.w1, WORKSPACES.w2],
      ...overrides.workspaces,
    },
    deps: overrides.deps ?? {},
    oneTimeCapabilities: new Set<string>(overrides.oneTime ?? []),
    workspaceId: overrides.workspaceId,
  } as any;
}

test('maxRisk keeps the higher tier regardless of argument order', () => {
  assert.equal(maxRisk('LOW', 'HIGH'), 'HIGH');
  assert.equal(maxRisk('CRITICAL', 'MEDIUM'), 'CRITICAL');
  assert.equal(maxRisk('MEDIUM', 'MEDIUM'), 'MEDIUM');
});

test('sessionLeases falls back to the active lease when the manager has no leases()', () => {
  const withActive = ctx({ sessions: { leases: undefined } });
  assert.deepEqual(
    sessionLeases(withActive, 's1').map((l: any) => l.workspaceId),
    ['w1'],
  );
  const none = ctx({ sessions: { leases: undefined, activeLease: () => null } });
  assert.deepEqual(sessionLeases(none, 's1'), []);
});

test('isTicketAuthorizedForSession checks actor session and connection ownership', () => {
  const c = ctx();
  assert.equal(isTicketAuthorizedForSession(c, 's1', {}), false);
  assert.equal(isTicketAuthorizedForSession(c, 'gone', { sessionId: 's1' }), false);
  assert.equal(isTicketAuthorizedForSession(c, 's1', { actor: 'oauth:Other' }), false);
  assert.equal(isTicketAuthorizedForSession(c, 's1', { sessionId: 's1' }), true);
  assert.equal(
    isTicketAuthorizedForSession(c, 's1', { actor: 'oauth:ChatGPT', sessionId: 's2' }),
    false,
  );

  const byConnection = ctx({ identity: { connectionId: 'c1' } });
  assert.equal(
    isTicketAuthorizedForSession(byConnection, 's1', {
      actor: 'oauth:ChatGPT',
      sessionId: 'old',
      connectionId: 'c1',
    }),
    true,
  );
  const bySubject = ctx({ identity: { subject: 'sub' } });
  assert.equal(
    isTicketAuthorizedForSession(bySubject, 's1', {
      actor: 'oauth:ChatGPT',
      sessionId: 'old',
      connectionSubject: 'sub',
    }),
    true,
  );
  assert.equal(
    isTicketAuthorizedForSession(bySubject, 's1', {
      actor: 'oauth:ChatGPT',
      sessionId: 's1',
      connectionId: 'someone-else',
    }),
    false,
    'a connection-owned ticket never falls back to session id equality',
  );
  const noCaller = ctx();
  assert.equal(
    isTicketAuthorizedForSession(noCaller, 's1', { actor: 'oauth:ChatGPT', connectionId: 'c1' }),
    false,
  );
});

test('resolveWorkspaceLease rejects unknown, conflicting and ambiguous targets', () => {
  const c = ctx();
  assert.throws(
    () => resolveWorkspaceLease(c, 's1', { workspace: 'Nope' }),
    (e: any) => e.code === 'WORKSPACE_NOT_FOUND' && /Nope/.test(e.message),
  );
  assert.throws(
    () => resolveWorkspaceLease(c, 's1', { workspaceId: 'wx' }),
    (e: any) => e.code === 'WORKSPACE_NOT_FOUND' && /wx/.test(e.message),
  );
  assert.throws(
    () => resolveWorkspaceLease(c, 's1', { workspace: 'One', workspaceId: 'w2' }),
    (e: any) => e.code === 'INVALID_WORKSPACE_TARGET',
  );
  assert.equal(
    resolveWorkspaceLease(c, 's1', { workspace: 'One', workspaceId: 'w1' }).workspaceId,
    'w1',
  );

  const multi = ctx({
    sessions: { leases: () => [{ workspaceId: 'w1' }, { workspaceId: 'w2' }] },
  });
  assert.throws(
    () => resolveWorkspaceLease(multi, 's1'),
    (e: any) =>
      e.code === 'WORKSPACE_REQUIRED' &&
      JSON.stringify(e.details.workspaces) ===
        JSON.stringify([
          { id: 'w1', name: 'One' },
          { id: 'w2', name: 'Two' },
        ]),
  );
});

test('workspaceRoot resolves the targeted or single lease host root', () => {
  assert.equal(workspaceRoot(ctx({ workspaceId: 'w1' }), 's1'), '/one');
  assert.equal(workspaceRoot(ctx({ workspaceId: 'w2' }), 's1'), null);
  const vanished = ctx({ workspaceId: 'w1', workspaces: { getLocal: () => null } });
  assert.equal(workspaceRoot(vanished, 's1'), null);
  const rootless = ctx({ workspaces: { getLocal: () => ({ id: 'w1' }) } });
  assert.equal(workspaceRoot(rootless, 's1'), null);
  assert.equal(workspaceRoot(ctx(), 's1'), '/one');
});

test('sameConnection compares actor, connection id and subject fallbacks', () => {
  const ticket = { actor: 'oauth:ChatGPT', sessionId: 'old' } as any;
  assert.equal(sameConnection(ctx(), 's1', ticket), false, 'no identities');

  const current = { actor: 'oauth:ChatGPT', connectionId: 'c1' };
  const byId = ctx({ identity: current });
  assert.equal(sameConnection(byId, 's1', { ...ticket, connectionId: 'c1' }), true);
  assert.equal(
    sameConnection(byId, 's1', { ...ticket, connectionId: 'c2', connectionSubject: 'c1' }),
    true,
    'subject falls back to current connection id',
  );
  assert.equal(sameConnection(byId, 's1', { ...ticket, connectionId: 'c2' }), false);
  assert.equal(
    sameConnection(byId, 's1', { ...ticket, actor: 'oauth:Other', connectionId: 'c1' }),
    false,
  );

  const lookups: string[] = [];
  const bySubject = ctx({
    sessions: {
      connectionIdentity: (id: string) => {
        lookups.push(id);
        return id === 's1'
          ? { actor: 'oauth:ChatGPT', subject: 'sub' }
          : { actor: 'oauth:ChatGPT', subject: 'sub' };
      },
    },
  });
  assert.equal(sameConnection(bySubject, 's1', ticket), true);
  assert.deepEqual(lookups, ['s1', 'old']);
  const empty = ctx({
    sessions: { connectionIdentity: () => ({ actor: 'oauth:ChatGPT' }) },
  });
  assert.equal(sameConnection(empty, 's1', ticket), false);
  const mismatchedOriginal = ctx({
    sessions: {
      connectionIdentity: (id: string) =>
        id === 's1' ? { actor: 'oauth:ChatGPT', subject: 'a' } : { actor: 'oauth:X', subject: 'a' },
    },
  });
  assert.equal(sameConnection(mismatchedOriginal, 's1', ticket), false);
});

function frozen(overrides: any = {}) {
  return {
    actor: 'oauth:ChatGPT',
    sessionId: 's1',
    workspaceId: 'w1',
    operation: { family: 'files:write', capability: 'files.write' },
    ...overrides,
  } as any;
}

test('verifyTicketAuthority revalidates lease, permission and capability', () => {
  assert.deepEqual(verifyTicketAuthority(ctx(), 'gone', frozen()), {
    ok: false,
    reason: 'session changed',
  });
  const activeOnly = ctx({
    capabilities: ['files.write'],
    sessions: { leaseForWorkspace: undefined },
  });
  assert.deepEqual(verifyTicketAuthority(activeOnly, 's1', frozen()), { ok: true });
  assert.deepEqual(verifyTicketAuthority(activeOnly, 's1', frozen({ workspaceId: 'w2' })), {
    ok: false,
    reason: 'workspace changed',
  });

  const denied = ctx({
    capabilities: ['files.write'],
    deps: { permissions: { decide: () => ({ outcome: 'deny' }) } },
  });
  assert.deepEqual(verifyTicketAuthority(denied, 's1', frozen()), {
    ok: false,
    reason: 'permission policy changed',
  });
  assert.deepEqual(verifyTicketAuthority(ctx(), 's1', frozen()), {
    ok: false,
    reason: 'capability changed',
  });
  const allowed = ctx({ deps: { permissions: { decide: () => ({ outcome: 'allow' }) } } });
  assert.deepEqual(verifyTicketAuthority(allowed, 's1', frozen()), { ok: true });
  const once = ctx({ oneTime: ['s1\u0000files.write\u0000*'] });
  assert.deepEqual(verifyTicketAuthority(once, 's1', frozen()), { ok: true });
  assert.deepEqual(verifyTicketAuthority(ctx(), 's1', frozen({ workspaceId: '' })), { ok: true });
});
