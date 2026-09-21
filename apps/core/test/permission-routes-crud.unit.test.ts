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
  const approvalsStore = new Map<string, any>();
  const permsStore = new Map<string, any>();

  const approvals = {
    list: () => Array.from(approvalsStore.values()),
    status: (id: string) => {
      const a = approvalsStore.get(id);
      return a ? { ...a } : null;
    },
    approve: (id: string, _scope: string) => {
      const a = approvalsStore.get(id);
      if (!a) throw new Error('not found');
      a.state = 'APPROVED';
      return a;
    },
    deny: (id: string) => {
      const a = approvalsStore.get(id);
      if (!a) throw new Error('not found');
      a.state = 'DENIED';
      return a;
    },
  };

  const sessions = {
    enableYolo: (sid: string) => ({ sessionId: sid, active: true }),
    disableYolo: (_sid: string) => {},
  };

  const permissions = {
    list: () => Array.from(permsStore.values()),
    get: (id: string) => permsStore.get(id) ?? null,
    upsert: (r: any) => permsStore.set(r.id, r),
    delete: (id: string) => permsStore.delete(id),
  };

  const audit = {
    append: () => {},
  };

  return {
    context: { approvals, permissions, sessions, audit } as any,
    approvalsStore,
    permsStore,
  };
}

test('permission routes: CRUD and validation', async () => {
  const { context, permsStore } = fixture();

  // GET permissions list
  const resGet = response();
  assert.equal(
    await handleApprovalPermissionRoutes(
      request('GET'),
      resGet,
      new URL('https://localhost/api/permissions'),
      context,
    ),
    true,
  );
  assert.equal(resGet.statusCode, 200);

  // POST critical persistent rule -> 400
  const resCrit = response();
  assert.equal(
    await handleApprovalPermissionRoutes(
      request('POST', { scope: 'workspace', effect: 'allow', matcher: 'privilege:escalate' }),
      resCrit,
      new URL('https://localhost/api/permissions'),
      context,
    ),
    true,
  );
  assert.equal(resCrit.statusCode, 400);

  // POST invalid predicate_json -> 400
  const resBadJson = response();
  assert.equal(
    await handleApprovalPermissionRoutes(
      request('POST', { predicate_json: '{ invalid' }),
      resBadJson,
      new URL('https://localhost/api/permissions'),
      context,
    ),
    true,
  );
  assert.equal(resBadJson.statusCode, 400);

  // POST V2 rule missing application/operation -> 400
  const resBadV2 = response();
  assert.equal(
    await handleApprovalPermissionRoutes(
      request('POST', { version: 2, predicate: { bad: 'pred' } }),
      resBadV2,
      new URL('https://localhost/api/permissions'),
      context,
    ),
    true,
  );
  assert.equal(resBadV2.statusCode, 400);

  // POST workspace scope missing workspaceId -> 400
  const resNoWs = response();
  assert.equal(
    await handleApprovalPermissionRoutes(
      request('POST', { scope: 'workspace' }),
      resNoWs,
      new URL('https://localhost/api/permissions'),
      context,
    ),
    true,
  );
  assert.equal(resNoWs.statusCode, 400);

  // POST session scope missing sessionId -> 400
  const resNoSession = response();
  await handleApprovalPermissionRoutes(
    request('POST', { scope: 'session' }),
    resNoSession,
    new URL('https://localhost/api/permissions'),
    context,
  );
  assert.equal(resNoSession.statusCode, 400);

  // POST malformed typed predicate members -> 400
  const typedBase = {
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

  const resBadOptions = response();
  await handleApprovalPermissionRoutes(
    request('POST', {
      scope: 'workspace',
      workspaceId: 'w1',
      effect: 'allow',
      predicate: { ...typedBase, allowedOptions: 'bad' },
    }),
    resBadOptions,
    new URL('https://localhost/api/permissions'),
    context,
  );
  assert.equal(resBadOptions.statusCode, 400);

  const resBadDialect = response();
  await handleApprovalPermissionRoutes(
    request('POST', {
      scope: 'workspace',
      workspaceId: 'w1',
      effect: 'allow',
      predicate: { ...typedBase, dialects: ['fish'] },
    }),
    resBadDialect,
    new URL('https://localhost/api/permissions'),
    context,
  );
  assert.equal(resBadDialect.statusCode, 400);

  const resBadEffect = response();
  await handleApprovalPermissionRoutes(
    request('POST', {
      scope: 'workspace',
      workspaceId: 'w1',
      effect: 'permit',
      predicate: typedBase,
    }),
    resBadEffect,
    new URL('https://localhost/api/permissions'),
    context,
  );
  assert.equal(resBadEffect.statusCode, 400);

  // POST valid V2 permission rule
  const resCreate = response();
  assert.equal(
    await handleApprovalPermissionRoutes(
      request('POST', {
        id: 'p1',
        scope: 'workspace',
        workspaceId: 'w1',
        capability: 'commands.run',
        effect: 'allow',
        predicate: {
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
        },
      }),
      resCreate,
      new URL('https://localhost/api/permissions'),
      context,
    ),
    true,
  );
  assert.equal(resCreate.statusCode, 200);
  assert.equal(permsStore.has('p1'), true);

  // POST update existing permission
  const resUpdate = response();
  assert.equal(
    await handleApprovalPermissionRoutes(
      request('POST', { id: 'p1', effect: 'deny' }),
      resUpdate,
      new URL('https://localhost/api/permissions'),
      context,
    ),
    true,
  );
  assert.equal(resUpdate.statusCode, 200);
  assert.equal(permsStore.get('p1')?.effect, 'deny');

  // DELETE permission
  const resDel = response();
  assert.equal(
    await handleApprovalPermissionRoutes(
      request('DELETE'),
      resDel,
      new URL('https://localhost/api/permissions/p1'),
      context,
    ),
    true,
  );
  assert.equal(resDel.statusCode, 200);
  assert.equal(permsStore.has('p1'), false);
});
