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

test('approval routes: GET /api/approvals and YOLO enablement', async () => {
  const { context, approvalsStore } = fixture();
  const res = response();

  // GET list
  assert.equal(
    await handleApprovalPermissionRoutes(
      request('GET'),
      res,
      new URL('https://localhost/api/approvals'),
      context,
    ),
    true,
  );
  assert.equal(res.statusCode, 200);

  // YOLO on missing approval -> 404
  const res404 = response();
  assert.equal(
    await handleApprovalPermissionRoutes(
      request('POST'),
      res404,
      new URL('https://localhost/api/approvals/missing/yolo'),
      context,
    ),
    true,
  );
  assert.equal(res404.statusCode, 404);

  // YOLO on invalid state -> 409
  approvalsStore.set('a_denied', { id: 'a_denied', state: 'DENIED', sessionId: 's1' });
  const res409 = response();
  assert.equal(
    await handleApprovalPermissionRoutes(
      request('POST'),
      res409,
      new URL('https://localhost/api/approvals/a_denied/yolo'),
      context,
    ),
    true,
  );
  assert.equal(res409.statusCode, 409);

  // YOLO on PENDING request -> 200
  approvalsStore.set('a_pending', {
    id: 'a_pending',
    state: 'PENDING',
    sessionId: 's1',
    actor: 'operator',
    workspaceId: 'w1',
  });
  const res200 = response();
  assert.equal(
    await handleApprovalPermissionRoutes(
      request('POST'),
      res200,
      new URL('https://localhost/api/approvals/a_pending/yolo'),
      context,
    ),
    true,
  );
  assert.equal(res200.statusCode, 200);
  assert.equal(JSON.parse(res200.body).ok, true);
});

test('approval routes: approve and deny actions', async () => {
  const { context, approvalsStore, permsStore } = fixture();

  // Deny missing -> 404
  const res404 = response();
  assert.equal(
    await handleApprovalPermissionRoutes(
      request('POST', {}),
      res404,
      new URL('https://localhost/api/approvals/missing/deny'),
      context,
    ),
    true,
  );
  assert.equal(res404.statusCode, 404);

  // Deny existing
  approvalsStore.set('a_deny', { id: 'a_deny', state: 'PENDING' });
  const resDeny = response();
  assert.equal(
    await handleApprovalPermissionRoutes(
      request('POST', {}),
      resDeny,
      new URL('https://localhost/api/approvals/a_deny/deny'),
      context,
    ),
    true,
  );
  assert.equal(resDeny.statusCode, 200);

  // Approve with command analysis inside scope -> generates V2 permission rule
  approvalsStore.set('a_cmd', {
    id: 'a_cmd',
    state: 'PENDING',
    workspaceId: 'w1',
    actor: 'operator',
    risk: 'LOW',
    operation: { family: 'git:status', capability: 'commands.run', risk: 'LOW' },
    payload: {
      permissionMatcher: 'git:status',
      commandAnalysis: {
        scope: 'inside',
        nodes: [
          {
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
          },
        ],
      },
    },
  });

  const resApprove = response();
  assert.equal(
    await handleApprovalPermissionRoutes(
      request('POST', { scope: 'workspace' }),
      resApprove,
      new URL('https://localhost/api/approvals/a_cmd/approve'),
      context,
    ),
    true,
  );
  assert.equal(resApprove.statusCode, 200);
  assert.equal(permsStore.size, 1);
  const createdPerm = Array.from(permsStore.values())[0];
  assert.equal(createdPerm.version, 2);
  assert.equal(createdPerm.scope, 'workspace');

  // Approve with outside scope command -> no rule created
  approvalsStore.set('a_out', {
    id: 'a_out',
    state: 'PENDING',
    operation: { family: 'git:status', capability: 'commands.run', risk: 'LOW' },
    payload: { commandAnalysis: { scope: 'outside', nodes: [] } },
  });
  const resOut = response();
  await handleApprovalPermissionRoutes(
    request('POST', { scope: 'session' }),
    resOut,
    new URL('https://localhost/api/approvals/a_out/approve'),
    context,
  );
  assert.equal(resOut.statusCode, 200);

  // Network approvals attached to command requests may be remembered too.
  // They must persist as network rules instead of being overwritten by the
  // commandAnalysis payload's typed command suggestion.
  approvalsStore.set('a_network', {
    id: 'a_network',
    state: 'PENDING',
    workspaceId: 'w1',
    sessionId: 's1',
    actor: 'operator',
    risk: 'MEDIUM',
    operation: {
      family: 'domain:registry.npmjs.org',
      capability: 'network',
      risk: 'MEDIUM',
    },
    payload: {
      permissionMatcher: 'npm:install:*',
      commandAnalysis: {
        scope: 'inside',
        nodes: [
          {
            id: 'n2',
            dialect: 'direct',
            argv: ['npm', 'install'],
            application: 'npm',
            operation: ['install'],
            options: [],
            modifiers: [],
            wrappers: [],
            risk: 'MEDIUM',
            effect: 'BUILD_OUTPUT',
            scope: 'inside',
          },
        ],
      },
    },
  });
  const resNetwork = response();
  await handleApprovalPermissionRoutes(
    request('POST', { scope: 'workspace' }),
    resNetwork,
    new URL('https://localhost/api/approvals/a_network/approve'),
    context,
  );
  assert.equal(resNetwork.statusCode, 200);
  const networkRule = Array.from(permsStore.values()).find(
    (rule: any) => rule.capability === 'network',
  );
  assert.equal(networkRule?.scope, 'workspace');
  assert.equal(networkRule?.matcher, 'domain:registry.npmjs.org');
  assert.equal(networkRule?.version, undefined);
});
