import assert from 'node:assert/strict';
import test from 'node:test';
import { resumeHostApproval } from '../src/approval-resume-host.js';

const BINDING = {
  attachmentId: 'att1',
  transport: 'extension',
  pairingId: null,
  profileId: null,
  tabId: 7,
  url: 'https://example.test/',
};

function hostTicket(overrides: any = {}) {
  return {
    id: 'h1',
    scope: 'host',
    state: 'APPROVED',
    operation: {
      family: 'browser:act',
      capability: 'browser.control',
      risk: 'HIGH',
      argsHash: 'payload-hash',
    },
    payload: { tool: 'browser_act_many', args: { actions: [] }, browserBinding: BINDING },
    ...overrides,
  } as any;
}

function fixture(o: any = {}) {
  let granted = o.granted ?? true;
  const calls: any[] = [];
  const live = o.live ?? {
    connected: true,
    attachmentId: 'att1',
    transport: 'extension',
    tabs: [{ tabId: 7, url: 'https://example.test/' }],
  };
  const context: any = {
    deps: {
      hostControlApproval:
        o.noApproval ? undefined : { canResume: () => o.canResume ?? true },
      hostControlAccess: {
        has: () => granted,
        identity: () => (o.identity === undefined ? { pairing: 'p' } : o.identity),
      },
    },
    worker: {
      execute: async (input: any) => {
        calls.push(['worker', input]);
        return o.statusFails ? { ok: false, error: { code: 'X', message: 'y' } } : { ok: true, value: live };
      },
    },
    approvals: {
      resume: async (_id: string, validate: any, execute: any, claim: any) => {
        const checked = await validate(o.current ?? o.ticket);
        if (!checked.ok) return checked;
        if (o.revokeBeforeClaim) granted = false;
        const claimed = claim();
        if (!claimed.ok) return claimed;
        return execute(o.current ?? o.ticket);
      },
    },
    callInner: async (...args: any[]) => {
      calls.push(['callInner', ...args]);
      return { done: args[1] };
    },
    revoke: () => (granted = false),
  };
  return { context, calls };
}

function run(t: any, o: any = {}) {
  const f = fixture({ ...o, ticket: t });
  return { f, result: resumeHostApproval(f.context, 's1', 'h1', t) };
}

test('host approvals require a resumable request and active grant', async () => {
  const t = hostTicket();
  assert.equal(run(t, { noApproval: true }).result, null);
  assert.equal(run(t, { canResume: false }).result, null);
  const pending = hostTicket({ state: 'PENDING' });
  assert.equal(run(pending).result, pending);
  assert.throws(
    () => run(t, { granted: false }).result,
    (e: any) => e.code === 'APPROVAL_CONTEXT_CHANGED',
  );
  const request = hostTicket({
    operation: { family: 'host-control:request', capability: 'desktop.control' },
  });
  assert.deepEqual(run(request).result, { status: 'approved', capability: 'desktop.control' });
});

test('browser action replay binds the live attachment and tab', async () => {
  const t = hostTicket();
  const { f, result } = run(t);
  assert.deepEqual(await result, { done: 'browser_act_many' });
  const status = f.calls[0][1];
  assert.deepEqual(status.operation, { kind: 'browser.status' });
  assert.deepEqual(status.scope.identity, { pairing: 'p' });
  const proof = f.calls[1][4];
  assert.equal(proof.payloadHash, 'payload-hash');
  assert.equal(proof.consumed, false);
});

test('browser validation reports each drifted precondition', async () => {
  const t = hostTicket();
  const unbound = hostTicket({ payload: { tool: 'browser_act_many' } });
  assert.deepEqual(await run(unbound).result, {
    ok: false,
    reason: 'browser target binding is unavailable',
  });
  assert.deepEqual(await run(t, { identity: null }).result, {
    ok: false,
    reason: 'browser connection identity changed',
  });
  assert.deepEqual(await run(t, { statusFails: true }).result, {
    ok: false,
    reason: 'browser attachment is unavailable',
  });
  assert.deepEqual(await run(t, { live: { connected: false, attachmentId: 'att1' } }).result, {
    ok: false,
    reason: 'browser attachment is unavailable',
  });
  assert.deepEqual(await run(t, { live: { connected: true, attachmentId: 'att1' } }).result, {
    ok: false,
    reason: 'browser attachment or approved tab changed',
  });
  const otherTab = { connected: true, attachmentId: 'att1', transport: 'extension', tabs: [{ tabId: 8, url: 'x' }] };
  assert.deepEqual(await run(t, { live: otherTab }).result, {
    ok: false,
    reason: 'browser attachment or approved tab changed',
  });
});

test('grant revocation between checks stops the replay', async () => {
  const t = hostTicket();
  const f = fixture({ ticket: t });
  f.context.approvals.resume = async (_id: string, validate: any) => {
    f.context.revoke();
    return validate(t);
  };
  assert.deepEqual(await resumeHostApproval(f.context, 's1', 'h1', t), {
    ok: false,
    reason: 'host control grant revoked',
  });
  const desktop = hostTicket({
    operation: { family: 'desktop:act', capability: 'desktop.control', risk: 'HIGH', argsHash: 'd' },
    payload: { tool: 'desktop_act_many' },
  });
  assert.deepEqual(await run(desktop, { revokeBeforeClaim: true }).result, {
    ok: false,
    reason: 'host control grant revoked',
  });
});

test('desktop replay skips browser binding and validates the frozen payload', async () => {
  const op = { family: 'desktop:act', capability: 'desktop.control', risk: 'HIGH', argsHash: 'd' };
  const desktop = hostTicket({ operation: op, payload: { tool: 'desktop_click' } });
  const { f, result } = run(desktop);
  assert.deepEqual(await result, { done: 'desktop_click' });
  assert.deepEqual(f.calls[0][3], {}, 'missing args replay as an empty object');
  assert.equal(f.calls.filter((c) => c[0] === 'worker').length, 0);

  await assert.rejects(
    async () => await run(hostTicket({ operation: op, payload: {} })).result,
    (e: any) => e.code === 'INVALID_REQUEST',
  );
  await assert.rejects(
    async () => await run(hostTicket({ operation: op, payload: { tool: 'desktop_type', requiresVolatileArgs: true } })).result,
    (e: any) => e.code === 'APPROVAL_CONTEXT_CHANGED',
  );
});
