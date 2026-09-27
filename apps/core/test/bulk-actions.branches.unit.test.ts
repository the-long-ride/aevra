import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleBulkAdminAction } from '../src/admin/bulk-actions.js';

function request(method: string | undefined, body?: unknown, raw?: string) {
  const text = raw ?? (body === undefined ? '' : JSON.stringify(body));
  const stream = Readable.from(text ? [Buffer.from(text)] : []) as any;
  stream.method = method;
  stream.headers = {};
  return stream;
}

function response() {
  const result = {
    statusCode: 0,
    body: '',
    headers: {} as Record<string, string>,
    setHeader(key: string, value: string) {
      result.headers[key] = value;
    },
    end(value = '') {
      result.body = String(value);
    },
  };
  return result as any;
}

async function call(
  method: string | undefined,
  path: string,
  context: any,
  body?: unknown,
  raw?: string,
  admin?: string,
) {
  const res = response();
  const handled = await handleBulkAdminAction(
    request(method, body, raw),
    res,
    new URL(`https://localhost${path}`),
    context,
    admin,
  );
  return {
    handled,
    status: res.statusCode,
    type: res.headers['content-type'],
    value: res.body ? JSON.parse(res.body) : undefined,
  };
}

function recorder() {
  const rules: any[] = [];
  return { rules, permissions: { upsert: (rule: any) => rules.push(rule) } };
}

const base = { effect: 'allow', scope: 'global', actors: ['connector:A'] };

test('bulk body parsing rejects empty, malformed and oversized payloads', async () => {
  const empty = await call('POST', '/api/permissions/bulk', {});
  assert.equal(empty.status, 400);
  assert.equal(empty.value.error.code, 'INVALID_BULK_REQUEST');
  assert.equal(empty.value.error.message, 'Select at least one capability');
  assert.equal(empty.type, 'application/json');

  const malformed = await call('POST', '/api/permissions/bulk', {}, undefined, '{nope');
  assert.equal(malformed.status, 400);
  assert.equal(malformed.value.error.code, 'ADMIN_BULK_FAILED');
  assert.equal(malformed.value.error.message, 'invalid JSON');

  const big = await call('POST', '/api/permissions/bulk', {}, undefined, 'x'.repeat(1024 * 1024 + 1));
  assert.equal(big.status, 413);
  assert.equal(big.value.error.message, 'request body too large');
});

test('bulk validation reports each missing selection', async () => {
  const fx = recorder();
  const unknownCaps = await call('POST', '/api/permissions/bulk', fx, {
    ...base,
    capabilities: ['files.teleport', 7],
  });
  assert.equal(unknownCaps.value.error.message, 'Select at least one capability');
  const noActors = await call('POST', '/api/permissions/bulk', fx, {
    capabilities: ['files.read'],
    actors: ['  ', ''],
  });
  assert.equal(noActors.value.error.message, 'Select at least one connector');
  const badScope = await call('POST', '/api/permissions/bulk', fx, {
    ...base,
    scope: 'planet',
    capabilities: ['files.read'],
  });
  assert.equal(badScope.value.error.message, 'Scope must be global, workspace, or session');
  const noMatchers = await call('POST', '/api/permissions/bulk', fx, {
    ...base,
    capabilities: ['commands.run'],
    commandMatchers: [],
  });
  assert.equal(noMatchers.value.error.message, 'Select at least one command matcher');
  assert.deepEqual(fx.rules, []);
});

test('default scope is workspace and validates workspace ids against listRemote', async () => {
  const fx = recorder();
  const context = { ...fx, workspaces: { listRemote: () => [{ id: 'w1' }, { id: 'w2' }] } };
  const none = await call('POST', '/api/permissions/bulk', context, {
    actors: ['connector:A'],
    capabilities: ['files.read'],
  });
  assert.equal(none.value.error.message, 'Select at least one workspace');
  const unknown = await call('POST', '/api/permissions/bulk', context, {
    actors: ['connector:A'],
    capabilities: ['files.read'],
    workspaceIds: ['w1', 'w9'],
  });
  assert.equal(unknown.value.error.message, 'Unknown workspace: w9');
  const ok = await call('POST', '/api/permissions/bulk', context, {
    effect: 'deny',
    actors: ['connector:A', 'oauth:B'],
    capabilities: ['files.read'],
    workspaceIds: ['w1', 'w2'],
    matcher: '   ',
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.value.count, 4);
  assert.deepEqual(
    fx.rules.map((rule) => [rule.effect, rule.scope, rule.actor, rule.workspaceId, rule.matcher]),
    [
      ['deny', 'workspace', 'connector:A', 'w1', '*'],
      ['deny', 'workspace', 'connector:A', 'w2', '*'],
      ['deny', 'workspace', 'oauth:B', 'w1', '*'],
      ['deny', 'workspace', 'oauth:B', 'w2', '*'],
    ],
  );
});

test('workspace validation falls back to listLocal and then to no workspaces', async () => {
  const fx = recorder();
  const local = await call(
    'POST',
    '/api/permissions/bulk',
    { ...fx, workspaces: { listLocal: () => [{ id: 'local-1' }] } },
    { actors: ['connector:A'], capabilities: ['git.read'], workspaceIds: ['local-1'] },
  );
  assert.equal(local.status, 201);
  assert.equal(fx.rules[0].workspaceId, 'local-1');
  const missing = await call('POST', '/api/permissions/bulk', fx, {
    actors: ['connector:A'],
    capabilities: ['git.read'],
    workspaceIds: ['local-1'],
  });
  assert.equal(missing.value.error.message, 'Unknown workspace: local-1');
});

test('session scope requires owned, known sessions', async () => {
  const fx = recorder();
  const sessions = { list: () => [{ id: 's1', actor: 'connector:A' }, { id: 's2', actor: 'oauth:Z' }] };
  const context = { ...fx, sessions };
  const body = { scope: 'session', actors: ['connector:A'], capabilities: ['files.search'] };
  assert.equal(
    (await call('POST', '/api/permissions/bulk', context, body)).value.error.message,
    'Select at least one session',
  );
  assert.equal(
    (await call('POST', '/api/permissions/bulk', context, { ...body, sessionIds: ['s404'] })).value
      .error.message,
    'Unknown session: s404',
  );
  assert.equal(
    (await call('POST', '/api/permissions/bulk', context, { ...body, sessionIds: ['s2'] })).value
      .error.message,
    'Session s2 is not owned by a selected connector',
  );
  const noList = await call('POST', '/api/permissions/bulk', fx, { ...body, sessionIds: ['s1'] });
  assert.equal(noList.value.error.message, 'Unknown session: s1');
  const ok = await call('POST', '/api/permissions/bulk', context, { ...body, sessionIds: ['s1'] });
  assert.equal(ok.status, 201);
  assert.deepEqual(
    [fx.rules[0].scope, fx.rules[0].sessionId, fx.rules[0].actor],
    ['session', 's1', 'connector:A'],
  );
});

test('command matcher mode expands commands and uses wildcard for other capabilities', async () => {
  const batches: any[][] = [];
  const context = { permissions: { upsertMany: (rules: any[]) => batches.push(rules) } };
  const result = await call('POST', '/api/permissions/bulk', context, {
    ...base,
    capabilities: ['commands.run', 'files.read', 'commands.run'],
    commandMatchers: ['npm test', 'npm test', 'git status'],
  });
  assert.equal(result.status, 201);
  assert.equal(batches.length, 1);
  assert.deepEqual(
    batches[0]!.map((rule) => [rule.capability, rule.matcher]),
    [
      ['commands.run', 'npm test'],
      ['commands.run', 'git status'],
      ['files.read', '*'],
    ],
  );
  assert.ok(batches[0]!.every((rule) => rule.id.startsWith('perm_')));
});

test('deny effect may target critical matchers and missing permission store is tolerated', async () => {
  const denied = await call('POST', '/api/permissions/bulk', {}, {
    ...base,
    effect: 'deny',
    capabilities: ['commands.run'],
    matcher: 'git:reset',
  });
  assert.equal(denied.status, 201);
  assert.equal(denied.value.rules[0].matcher, 'git:reset');
  const critical = await call('POST', '/api/permissions/bulk', {}, {
    ...base,
    capabilities: ['commands.run'],
    commandMatchers: ['security:disable'],
  });
  assert.equal(critical.value.error.code, 'CRITICAL_RULE_FORBIDDEN');
});

test('thrown store errors keep their status and code, strings are stringified', async () => {
  const coded = await call(
    'POST',
    '/api/permissions/bulk',
    {
      permissions: {
        upsert: () => {
          throw Object.assign(new Error('store locked'), { status: 423, code: 'LOCKED' });
        },
      },
    },
    { ...base, capabilities: ['files.read'] },
  );
  assert.deepEqual([coded.status, coded.value.error.code, coded.value.error.message], [
    423,
    'LOCKED',
    'store locked',
  ]);
  const plain = await call(
    'POST',
    '/api/permissions/bulk',
    {
      permissions: {
        upsertMany: () => {
          throw 'plain failure';
        },
      },
    },
    { ...base, capabilities: ['files.read'] },
  );
  assert.deepEqual([plain.status, plain.value.error.code, plain.value.error.message], [
    400,
    'ADMIN_BULK_FAILED',
    'plain failure',
  ]);
});

test('safe mode blocks audit clearing and session revocation too', async () => {
  let cleared = false;
  const context = { safeMode: () => true, audit: { clear: () => (cleared = true) } };
  for (const [method, path] of [
    ['DELETE', '/api/audit'],
    ['POST', '/api/sessions/revoke-others'],
  ] as const) {
    const result = await call(method, path, context);
    assert.equal(result.status, 503);
    assert.equal(result.value.error.code, 'SAFE_MODE');
  }
  assert.equal(cleared, false);
  const read = await call('GET', '/api/workspaces/w1/admissions', { safeMode: () => true });
  assert.equal(read.status, 200);
});

test('optional services default to empty results', async () => {
  const admissions = await call(undefined, '/api/workspaces/w%201/admissions', {});
  assert.deepEqual([admissions.status, admissions.value], [200, []]);
  const seen: string[] = [];
  await call(undefined, '/api/workspaces/w%201/admissions', {
    profiles: { listMappings: (id: string) => (seen.push(id), []) },
  });
  assert.deepEqual(seen, ['w 1']);
  const audit = await call('DELETE', '/api/audit', {});
  assert.deepEqual(audit.value, { ok: true, removed: 0 });
  const revoke = await call('POST', '/api/sessions/revoke-others', {});
  assert.deepEqual(revoke.value, {
    ok: true,
    revokedRemote: 0,
    preservedConnectors: 0,
    revokedAdmin: 0,
    preservedAdmin: 0,
  });
  const unrelated = await call('GET', '/api/permissions/bulk', {});
  assert.equal(unrelated.handled, false);
  assert.equal((await call(undefined, '/api/elsewhere', {})).handled, false);
});

test('revoke-others treats sessions with missing actors as revocable', async () => {
  const revoked: string[] = [];
  const result = await call('POST', '/api/sessions/revoke-others', {
    sessions: { list: () => [{ id: 'anon' }, { id: 'c', actor: 'connector:X' }] },
  }, undefined, undefined, 'admin-1');
  assert.equal(result.value.revokedRemote, 1);
  assert.equal(result.value.preservedConnectors, 1);
  const withRevoke = await call('POST', '/api/sessions/revoke-others', {
    sessions: { list: () => [{ id: 'anon' }], revoke: (id: string) => revoked.push(id) },
  });
  assert.equal(withRevoke.value.revokedRemote, 1);
  assert.deepEqual(revoked, ['anon']);
});
