import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleApprovalPermissionRoutes } from '../src/admin/routes/approval-permission-routes.js';

function request(method: string | undefined, body?: unknown) {
  const text = body === undefined ? '' : JSON.stringify(body);
  const stream = Readable.from(text ? [Buffer.from(text)] : []) as any;
  stream.method = method;
  stream.headers = {};
  return stream;
}

function response() {
  const res = {
    statusCode: 0,
    body: '',
    setHeader() {},
    end(v = '') {
      res.body = String(v);
    },
  };
  return res as any;
}

function fixture(options: { approveThrows?: unknown } = {}) {
  const approvalsStore = new Map<string, any>();
  const permsStore = new Map<string, any>();
  const calls = { approve: [] as string[], deny: [] as string[], disabledYolo: [] as string[] };
  const approvals = {
    status: (id: string) => (approvalsStore.has(id) ? { ...approvalsStore.get(id) } : null),
    approve: (id: string, scope: string) => {
      calls.approve.push(`${id}:${scope}`);
      if (options.approveThrows !== undefined) throw options.approveThrows;
      const a = approvalsStore.get(id);
      a.state = 'APPROVED';
      return { ...a };
    },
    deny: (id: string) => {
      calls.deny.push(id);
      const a = approvalsStore.get(id);
      a.state = 'DENIED';
      return { ...a };
    },
  };
  const sessions = {
    enableYolo: (sid: string) => ({ sessionId: sid, active: true }),
    disableYolo: (sid: string) => calls.disabledYolo.push(sid),
  };
  const permissions = {
    list: () => Array.from(permsStore.values()),
    get: (id: string) => permsStore.get(id) ?? null,
    upsert: (r: any) => permsStore.set(r.id, r),
    delete: (id: string) => permsStore.delete(id),
  };
  return {
    context: { approvals, permissions, sessions } as any,
    approvalsStore,
    permsStore,
    calls,
  };
}

async function call(context: any, method: string | undefined, path: string, body?: unknown) {
  const res = response();
  const handled = await handleApprovalPermissionRoutes(
    request(method, body),
    res,
    new URL(`https://localhost${path}`),
    context,
  );
  return { handled, status: res.statusCode, body: res.body ? JSON.parse(res.body) : undefined };
}

const gitNode = {
  id: 'n1',
  dialect: 'direct',
  argv: ['git', 'status'],
  application: 'git',
  operation: ['status'],
  options: [],
  modifiers: [],
  wrappers: [],
  risk: 'LOW',
  effect: 'READ_ONLY',
  scope: 'inside',
};

function commandApproval(id: string, analysisScope: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    state: 'PENDING',
    workspaceId: 'w1',
    sessionId: 's1',
    actor: 'operator',
    risk: 'LOW',
    operation: { family: 'git:status', capability: 'commands.run', risk: 'LOW' },
    payload: { commandAnalysis: { scope: analysisScope, nodes: [gitNode] }, ...extra },
  };
}

test('a request without a method is treated as GET and missing stores list nothing', async () => {
  const approvalsList = await call({}, undefined, '/api/approvals');
  assert.equal(approvalsList.status, 200);
  assert.deepEqual(approvalsList.body, []);
  const permissionsList = await call({}, 'GET', '/api/permissions');
  assert.deepEqual(permissionsList.body, []);
  const removed = await call({}, 'DELETE', '/api/permissions/p-none');
  assert.deepEqual(removed.body, { ok: true, removed: null });
  assert.equal((await call({}, 'GET', '/api/unrelated')).handled, false);
});

test('YOLO on an already approved request keeps the ticket and does not re-approve', async () => {
  const { context, approvalsStore, calls } = fixture();
  approvalsStore.set('a1', { id: 'a1', state: 'APPROVED', sessionId: 's1', actor: 'op' });
  const result = await call(context, 'POST', '/api/approvals/a1/yolo');
  assert.equal(result.status, 200);
  assert.equal(result.body.ticket.state, 'APPROVED');
  assert.deepEqual(result.body.yolo, { sessionId: 's1', active: true });
  assert.deepEqual(calls.approve, []);
});

test('YOLO rolls back the session flag when approving the pending request fails', async () => {
  const { context, approvalsStore, calls } = fixture({ approveThrows: new Error('store offline') });
  approvalsStore.set('a1', { id: 'a1', state: 'PENDING', sessionId: 's9', actor: 'op' });
  const result = await call(context, 'POST', '/api/approvals/a1/yolo');
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, 'YOLO_NOT_ALLOWED');
  assert.equal(result.body.error.message, 'store offline');
  assert.deepEqual(calls.disabledYolo, ['s9']);
});

test('YOLO reports non-Error failures as text', async () => {
  const { context, approvalsStore } = fixture({ approveThrows: 'plain refusal' });
  approvalsStore.set('a1', { id: 'a1', state: 'EXPIRED', sessionId: 's1' });
  // EXPIRED is not re-approved, so enable succeeds without calling approve.
  assert.equal((await call(context, 'POST', '/api/approvals/a1/yolo')).status, 200);
  approvalsStore.set('a2', { id: 'a2', state: 'PENDING', sessionId: 's1' });
  const failed = await call(context, 'POST', '/api/approvals/a2/yolo');
  assert.equal(failed.body.error.message, 'plain refusal');
});

test('workspace admission approvals are always once and never persist a rule', async () => {
  const { context, approvalsStore, permsStore, calls } = fixture();
  approvalsStore.set('adm', {
    id: 'adm',
    state: 'PENDING',
    risk: 'LOW',
    operation: { family: 'workspace:select', capability: 'workspace.select', risk: 'LOW' },
  });
  const result = await call(context, 'POST', '/api/approvals/adm/approve', { scope: 'workspace' });
  assert.equal(result.status, 200);
  assert.deepEqual(calls.approve, ['adm:once']);
  assert.equal(permsStore.size, 0);
});

test('approving an approved request or denying a denied one is idempotent', async () => {
  const { context, approvalsStore, permsStore, calls } = fixture();
  approvalsStore.set('done', { id: 'done', state: 'APPROVED', operation: { family: 'x' } });
  approvalsStore.set('gone', { id: 'gone', state: 'DENIED', operation: { family: 'x' } });
  const approved = await call(context, 'POST', '/api/approvals/done/approve', {
    scope: 'global',
  });
  assert.equal(approved.body.ticket.state, 'APPROVED');
  const denied = await call(context, 'POST', '/api/approvals/gone/deny', {});
  assert.equal(denied.body.ticket.state, 'DENIED');
  assert.deepEqual(calls.approve, []);
  assert.deepEqual(calls.deny, []);
  assert.equal(permsStore.size, 0);
});

test('an inside command approved globally becomes a global typed rule with a wildcard matcher', async () => {
  const { context, approvalsStore, permsStore } = fixture();
  approvalsStore.set('g', commandApproval('g', 'inside'));
  await call(context, 'POST', '/api/approvals/g/approve', { scope: 'global' });
  const [rule] = Array.from(permsStore.values());
  assert.equal(rule.scope, 'global');
  assert.equal(rule.matcher, '*');
  assert.equal(rule.version, 2);
  assert.equal('workspaceId' in rule, false);
  assert.equal('sessionId' in rule, false);
  assert.equal(JSON.parse(rule.predicate_json).application, 'git');
});

test('an inside command approved for the session is bound to that session', async () => {
  const { context, approvalsStore, permsStore } = fixture();
  approvalsStore.set('s', commandApproval('s', 'inside', { permissionMatcher: 'git:status' }));
  await call(context, 'POST', '/api/approvals/s/approve', { scope: 'session' });
  const [rule] = Array.from(permsStore.values());
  assert.equal(rule.scope, 'session');
  assert.equal(rule.sessionId, 's1');
  assert.equal(rule.matcher, 'git:status');
});

test('an unrecognised remember scope on an inside command still persists a global rule', async () => {
  const { context, approvalsStore, permsStore } = fixture();
  approvalsStore.set('u', commandApproval('u', 'inside'));
  await call(context, 'POST', '/api/approvals/u/approve', { scope: 'forever' });
  assert.equal(Array.from(permsStore.values())[0].scope, 'global');
});

test('a command touching paths outside the workspace is never remembered', async () => {
  const { context, approvalsStore, permsStore } = fixture();
  approvalsStore.set('o', commandApproval('o', 'outside'));
  const result = await call(context, 'POST', '/api/approvals/o/approve', { scope: 'workspace' });
  assert.equal(result.status, 200);
  assert.equal(result.body.ticket.state, 'APPROVED');
  assert.equal(permsStore.size, 0);
});

test('a once approval of a command stores no rule and approval defaults to once', async () => {
  const { context, approvalsStore, permsStore, calls } = fixture();
  approvalsStore.set('c', commandApproval('c', 'inside'));
  await call(context, 'POST', '/api/approvals/c/approve', {});
  assert.deepEqual(calls.approve, ['c:once']);
  assert.equal(permsStore.size, 0);
});

test('approving without a permission store still approves the ticket', async () => {
  const { context, approvalsStore } = fixture();
  approvalsStore.set('c', commandApproval('c', 'inside'));
  const result = await call(
    { ...context, permissions: undefined },
    'POST',
    '/api/approvals/c/approve',
    { scope: 'workspace' },
  );
  assert.equal(result.body.ticket.state, 'APPROVED');
});
