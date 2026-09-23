import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleApprovalPermissionRoutes } from '../src/admin/routes/approval-permission-routes.js';

function request(method: string, body?: unknown) {
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

function fixture() {
  const permsStore = new Map<string, any>();
  const permissions = {
    list: () => Array.from(permsStore.values()),
    get: (id: string) => permsStore.get(id) ?? null,
    upsert: (r: any) => permsStore.set(r.id, r),
    delete: (id: string) => permsStore.delete(id),
  };
  return { context: { permissions } as any, permsStore };
}

async function post(context: any, body: unknown) {
  const res = response();
  await handleApprovalPermissionRoutes(
    request('POST', body),
    res,
    new URL('https://localhost/api/permissions'),
    context,
  );
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

const typed = {
  version: 2,
  application: 'git',
  operation: ['status'],
  allowedModifiers: [],
  allowedOptions: [],
  positionalConstraint: 'workspace-paths',
  targetScope: 'workspace',
  backends: ['host'],
  dialects: ['direct'],
  executableFingerprint: '*',
  wrapperFingerprints: ['*'],
};

test('listing normalises snake_case storage rows and passes through non-objects', async () => {
  const { context, permsStore } = fixture();
  permsStore.set('p1', {
    id: 'p1',
    workspace_id: 'w1',
    session_id: 's1',
    created_at: 'c-time',
    last_used_at: 'u-time',
    expires_at: 'e-time',
    predicateJson: '{}',
  });
  permsStore.set('p2', null);
  const res = response();
  await handleApprovalPermissionRoutes(
    request('GET'),
    res,
    new URL('https://localhost/api/permissions'),
    context,
  );
  const [first, second] = JSON.parse(res.body);
  assert.equal(first.workspaceId, 'w1');
  assert.equal(first.sessionId, 's1');
  assert.equal(first.createdAt, 'c-time');
  assert.equal(first.lastUsedAt, 'u-time');
  assert.equal(first.expiresAt, 'e-time');
  assert.equal(first.predicate_json, '{}');
  assert.equal(second, null);
});

test('an unknown scope is refused', async () => {
  const { context } = fixture();
  const result = await post(context, { scope: 'planet' });
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, 'INVALID_SCOPE');
});

test('a new rule without an id gets a generated id, version 1 and a timestamp', async () => {
  const { context, permsStore } = fixture();
  const result = await post(context, { effect: 'deny', capability: 'files.write', matcher: '*' });
  assert.equal(result.status, 200);
  assert.match(result.body.rule.id, /^perm_/);
  assert.equal(result.body.rule.version, 1);
  assert.equal(typeof result.body.rule.createdAt, 'string');
  assert.equal(permsStore.size, 1);
});

test('a new rule keeps a supplied creation time and raw predicate_json is parsed', async () => {
  const { context, permsStore } = fixture();
  const result = await post(context, {
    id: 'p-json',
    scope: 'session',
    sessionId: 's1',
    effect: 'allow',
    predicate_json: JSON.stringify(typed),
    createdAt: 'fixed-time',
  });
  assert.equal(result.status, 200);
  const stored = permsStore.get('p-json');
  assert.equal(stored.version, 2);
  assert.equal(stored.createdAt, 'fixed-time');
  assert.equal(JSON.parse(stored.predicate_json).application, 'git');
});

test('an existing typed rule can be edited without resending its predicate', async () => {
  const { context, permsStore } = fixture();
  permsStore.set('p1', {
    id: 'p1',
    effect: 'allow',
    scope: 'workspace',
    workspace_id: 'w1',
    version: 2,
    predicate_json: JSON.stringify(typed),
    created_at: 'original-time',
  });
  const result = await post(context, { id: 'p1', version: 2, effect: 'deny' });
  assert.equal(result.status, 200);
  const stored = permsStore.get('p1');
  assert.equal(stored.effect, 'deny');
  assert.equal(stored.workspaceId, 'w1');
  assert.equal(stored.createdAt, 'original-time');
  assert.equal(stored.predicate_json, JSON.stringify(typed));
});

test('an existing legacy rule without a version stays version 1 when edited', async () => {
  const { context, permsStore } = fixture();
  permsStore.set('p-legacy', { id: 'p-legacy', effect: 'allow', session_id: 's1', scope: 'session' });
  const result = await post(context, { id: 'p-legacy', matcher: 'git:status' });
  assert.equal(result.status, 200);
  assert.equal(permsStore.get('p-legacy').version, 1);
  assert.equal(permsStore.get('p-legacy').sessionId, 's1');
});

test('attaching a predicate to an existing rule upgrades it to version 2', async () => {
  const { context, permsStore } = fixture();
  permsStore.set('p-up', { id: 'p-up', effect: 'allow', scope: 'global', version: 1 });
  const result = await post(context, { id: 'p-up', predicate: typed });
  assert.equal(result.status, 200);
  assert.equal(permsStore.get('p-up').version, 2);
  assert.equal(JSON.parse(permsStore.get('p-up').predicate_json).application, 'git');
});

test('a version 2 edit of a rule with no stored predicate is refused', async () => {
  const { context, permsStore } = fixture();
  permsStore.set('p-bare', { id: 'p-bare', effect: 'allow', scope: 'global', version: 2 });
  const result = await post(context, { id: 'p-bare', effect: 'deny' });
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, 'INVALID_PREDICATE');
});

test('deleting an unknown rule reports nothing removed', async () => {
  const { context } = fixture();
  const res = response();
  await handleApprovalPermissionRoutes(
    request('DELETE'),
    res,
    new URL('https://localhost/api/permissions/p-missing'),
    context,
  );
  assert.deepEqual(JSON.parse(res.body), { ok: true, removed: null });
});
