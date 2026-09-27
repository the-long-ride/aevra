import assert from 'node:assert/strict';
import test from 'node:test';
import { HostControlApproval } from '../src/control/host-control-approval.js';

function harness(opts: { has?: boolean; identity?: any; caller?: any; states?: Record<string, string>; active?: boolean; tickets?: Record<string, any> } = {}) {
  const before: Array<(t: any) => void> = [];
  const after: Array<(t: any) => void> = [];
  const requests: any[] = [];
  const grants: any[] = [];
  const approvals = {
    addBeforeApprovedHandler: (fn: any) => before.push(fn),
    addApprovedHandler: (fn: any) => after.push(fn),
    request: (input: any) => (requests.push(input), { status: 'pending', requestId: 'req_1' }),
    status: (id: string) => opts.tickets?.[id] ?? null,
  };
  const access = {
    has: () => opts.has ?? false,
    identity: () => ('identity' in opts ? opts.identity : { kind: 'oauth', key: 'conn-1' }),
    isActive: () => opts.active ?? true,
    grant: (...args: unknown[]) => grants.push(args),
  };
  const sessions = {
    connectionIdentity: () => ('caller' in opts ? opts.caller : { actor: 'oauth:Client' }),
    connectionState: (key: string) => (opts.states?.[key] ? { status: opts.states[key] } : undefined),
  };
  const subject = new HostControlApproval(sessions as any, access as any, approvals as any);
  return { subject, before: before[0]!, after: after[0]!, requests, grants };
}

const hostTicket = (extra: Record<string, unknown> = {}) => ({
  scope: 'host',
  identity: { kind: 'oauth', key: 'conn-1' },
  operation: { family: 'host-control:request', capability: 'browser.control' },
  ...extra,
});

test('requestHostControl short-circuits, rejects unknown callers, and requests approval', async () => {
  assert.deepEqual(await harness({ has: true }).subject.requestHostControl('s', 'browser.control', { tool: 't', args: {} }), { status: 'approved' });
  await assert.rejects(async () => harness({ identity: null }).subject.requestHostControl('s', 'browser.control', { tool: 't', args: {} }), /UNAUTHORIZED/);
  await assert.rejects(async () => harness({ caller: null }).subject.requestHostControl('s', 'browser.control', { tool: 't', args: {} }), /UNAUTHORIZED/);
  const h = harness();
  await h.subject.requestHostControl('s', 'desktop.control', { tool: 'desktop_click', args: { x: 1 } });
  const req = h.requests[0];
  assert.equal(req.actor, 'oauth:Client');
  assert.equal(req.scope, 'host');
  assert.equal(req.operation.capability, 'desktop.control');
  assert.match(req.operation.argsHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(req.payload, { tool: 'host_control_request', capability: 'desktop.control', originalTool: 'desktop_click' });
});

test('canResume requires a host ticket with the same identity', () => {
  const tickets = {
    ok: hostTicket(),
    ws: { ...hostTicket(), scope: 'workspace' },
    kind: hostTicket({ identity: { kind: 'session', key: 'conn-1' } }),
    key: hostTicket({ identity: { kind: 'oauth', key: 'conn-2' } }),
    none: hostTicket({ identity: undefined }),
  };
  const h = harness({ tickets });
  assert.equal(h.subject.canResume('s', 'ok'), true);
  for (const id of ['ws', 'kind', 'key', 'none', 'missing']) assert.equal(h.subject.canResume('s', id), false, id);
  assert.equal(harness({ tickets, identity: null }).subject.canResume('s', 'ok'), false);
});

test('before-approval validation checks identity activity and oauth connection state', () => {
  const revoked = /Host control connection was revoked/;
  assert.equal(harness().before({ scope: 'workspace' }), undefined);
  assert.throws(() => harness().before(hostTicket({ identity: undefined })), revoked);
  assert.throws(() => harness({ active: false }).before(hostTicket()), revoked);
  for (const status of ['CONNECTED', 'GRACE', 'OFFLINE']) {
    assert.doesNotThrow(() => harness({ states: { 'conn-1': status } }).before(hostTicket()));
  }
  assert.throws(() => harness({ states: { 'conn-1': 'REVOKED' } }).before(hostTicket()), revoked);
  assert.throws(() => harness().before(hostTicket()), revoked);
  assert.doesNotThrow(() => harness().before(hostTicket({ identity: { kind: 'session', key: 'k' } })));
});

test('approved handler grants only live host-control requests', () => {
  const granted = (ticket: any, states?: Record<string, string>) => {
    const h = harness({ states });
    h.after(ticket);
    return h.grants;
  };
  assert.deepEqual(granted({ ...hostTicket(), scope: 'workspace' }), []);
  assert.deepEqual(granted(hostTicket({ operation: { family: 'browser:click' } })), []);
  assert.deepEqual(granted(hostTicket({ identity: undefined })), []);
  assert.deepEqual(granted(hostTicket(), { 'conn-1': 'REVOKED' }), []);
  assert.deepEqual(granted(hostTicket(), { 'conn-1': 'CONNECTED' }), [[{ kind: 'oauth', key: 'conn-1' }, 'browser.control', 'local-approval']]);
  assert.equal(granted(hostTicket({ identity: { kind: 'session', key: 'k' } })).length, 1);
});
