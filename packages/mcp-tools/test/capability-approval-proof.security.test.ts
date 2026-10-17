import assert from 'node:assert/strict';
import test from 'node:test';
import { resumeApproval } from '../src/approval-resume.js';
import { authorizeCapability, gated } from '../src/authorization.js';
import { McpToolService } from '../src/service.js';

// F06: a one-time capability approval must authorize exactly the frozen call it
// was granted for. It used to be published into a service-wide Set for the whole
// replay, so any concurrent call in the same session with the same capability
// rode on it.

function capTicket(overrides: any = {}) {
  return {
    id: 'req1',
    actor: 'oauth:ChatGPT',
    sessionId: 's1',
    connectionId: 'conn1',
    workspaceId: 'w1',
    operation: { family: 'capability:files.delete', capability: 'files.delete', risk: 'HIGH' },
    payload: {
      tool: 'capability_request',
      permissionMatcher: '*',
      original: { tool: 'file_delete', args: { path: '/approved.txt' } },
    },
    expectedState: {},
    state: 'APPROVED',
    decisionScope: 'once',
    ...overrides,
  };
}

function fixture(ticket: any, critical = false) {
  const requests: any[] = [];
  const lease = { id: 'l1', workspaceId: 'w1', capabilities: ['files.read'] };
  const identity = { actor: 'oauth:ChatGPT', connectionId: 'conn1', subject: 'conn1' };
  const context: any = {
    sessions: {
      get: (id: string) => ({ id, actor: 'oauth:ChatGPT', subject: 'conn1' }),
      activeLease: () => lease,
      leases: () => [lease],
      leaseForWorkspace: (_s: string, id: string) => (id === 'w1' ? lease : null),
      isYolo: () => false,
      connectionIdentity: () => identity,
    },
    workspaces: {
      getLocal: (id: string) => (id === 'w1' ? { id, name: 'One', description: '' } : null),
      capabilityRoots: () => [],
    },
    worker: { execute: async () => ({ ok: true, value: {} }) },
    reads: {},
    approvals: {
      status: () => ticket,
      request: async (input: any) => {
        requests.push(input);
        return { status: 'approval_pending', requestId: `pending${requests.length}` };
      },
      resume: async (_id: string, validate: any, execute: any, claim?: any) => {
        const checked = await validate(ticket);
        if (!checked.ok) return checked;
        if (claim) {
          const claimed = await claim(ticket);
          if (!claimed.ok) return claimed;
        }
        return execute(ticket);
      },
    },
    deps: { settings: { get: () => critical } },
    oneTimeCapabilities: new Set<string>(),
    processStart: async () => ({}),
    callInner: async () => ({}),
  };
  return { context, requests };
}

const deleteCall = (path: string) => ({ tool: 'file_delete', args: { path } });

test('a concurrent call in the same session is not authorized by an in-flight one-time approval', async () => {
  const ticket = capTicket();
  const { context, requests } = fixture(ticket);
  let concurrent: any;
  let resumed: any;
  context.callInner = async (sessionId: string, tool: string, args: any, proof: any) => {
    // While the approved replay is in flight, an unrelated call arrives in the
    // same session through the shared runtime context.
    concurrent = await authorizeCapability(
      context,
      sessionId,
      'files.delete',
      deleteCall('/other.txt'),
      '*',
      'HIGH',
    );
    // The replay itself runs with the per-invocation proof the service attaches.
    resumed = await authorizeCapability(
      { ...context, capabilityApprovalProof: proof },
      sessionId,
      'files.delete',
      { tool, args },
      '*',
      'HIGH',
    );
    return { ran: tool };
  };
  assert.deepEqual(await resumeApproval(context, 's1', 'req1'), { ran: 'file_delete' });
  assert.ok('response' in concurrent, 'concurrent call must not ride on the approval');
  assert.equal(concurrent.response.status, 'approval_pending');
  assert.equal(requests.length, 1);
  assert.ok('authorization' in resumed, 'the approved call itself still runs');
});

test('a one-time approval resumes from another session of the same OAuth connection', async () => {
  const ticket = capTicket({ sessionId: 's0' });
  const { context } = fixture(ticket);
  let gate: any;
  context.callInner = async (sessionId: string, tool: string, args: any, proof: any) => {
    assert.equal(sessionId, 's1');
    assert.equal(proof?.sessionId, 's1');
    gate = await authorizeCapability(
      { ...context, capabilityApprovalProof: proof },
      sessionId,
      'files.delete',
      { tool, args },
      '*',
      'HIGH',
    );
    return { ran: tool };
  };
  assert.deepEqual(await resumeApproval(context, 's1', 'req1'), { ran: 'file_delete' });
  assert.ok('authorization' in gate);
});

function serviceWithSession() {
  const sessions: any = {
    get: (id: string) => (id === 's1' ? { id, actor: 'oauth:ChatGPT' } : null),
    touch: () => undefined,
  };
  return new McpToolService(sessions, {} as any, {} as any, {} as any) as any;
}

function proofFor(ticket: any, context: any) {
  let captured: any;
  context.callInner = async (_s: string, _t: string, _a: any, proof: any) => {
    captured = proof;
    return {};
  };
  return resumeApproval(context, 's1', 'req1').then(() => captured);
}

test('the service accepts a capability proof only for the exact frozen call, once', async () => {
  const ticket = capTicket();
  const proof = await proofFor(ticket, fixture(ticket).context);
  assert.equal(proof.consumed, false);
  const inner = serviceWithSession().context().callInner;
  await assert.rejects(
    () => inner('s1', 'file_delete', { path: '/other.txt' }, proof),
    (e: any) => e.code === 'APPROVAL_CONTEXT_CHANGED',
  );
  await assert.rejects(
    () => inner('s1', 'file_write', { path: '/approved.txt' }, proof),
    (e: any) => e.code === 'APPROVAL_CONTEXT_CHANGED',
  );
  const fresh = await proofFor(ticket, fixture(ticket).context);
  await assert.rejects(() => inner('s1', 'file_delete', { path: '/approved.txt' }, fresh));
  assert.equal(fresh.consumed, true, 'the exact frozen call claims the proof');
  await assert.rejects(
    () => inner('s1', 'file_delete', { path: '/approved.txt' }, fresh),
    (e: any) => e.code === 'APPROVAL_CONTEXT_CHANGED',
  );
});

test('a non-CRITICAL one-time approval does not satisfy a forced CRITICAL confirmation', async () => {
  const normalized: any = {
    family: 'files:delete',
    capability: 'files.delete',
    risk: 'CRITICAL',
    argsHash: 'x',
  };
  const high = fixture(capTicket(), true);
  const proof = {
    kind: 'capability',
    requestId: 'req1',
    sessionId: 's1',
    capability: 'files.delete',
    matcher: '*',
    risk: 'HIGH',
    binding: 'b',
    consumed: true,
  };
  let ran = 0;
  const result: any = await gated(
    { ...high.context, capabilityApprovalProof: proof },
    's1',
    normalized,
    {},
    {},
    async () => ++ran,
  );
  assert.equal(result.status, 'approval_pending');
  assert.equal(ran, 0);
  const critical = fixture(capTicket(), true);
  const ok = await gated(
    { ...critical.context, capabilityApprovalProof: { ...proof, risk: 'CRITICAL' } },
    's1',
    normalized,
    {},
    {},
    async () => ++ran,
  );
  assert.equal(ok, 1);
});
