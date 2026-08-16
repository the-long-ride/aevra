import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleSessionConnectorRoutes } from '../src/admin/routes/session-connector-routes.js';

function request(method: string, value?: unknown) {
  const text = value === undefined ? '' : JSON.stringify(value);
  const stream = Readable.from(text ? [Buffer.from(text)] : []) as any;
  stream.method = method;
  stream.headers = {};
  return stream;
}
function response() {
  const result = {
    statusCode: 0,
    body: '',
    setHeader() {},
    end(v = '') {
      result.body = String(v);
    },
  };
  return result as any;
}
async function call(pathname: string, method: string, context: any = {}, value?: unknown) {
  const res = response();
  const handled = await handleSessionConnectorRoutes(
    request(method, value),
    res,
    new URL(`https://localhost${pathname}`),
    context,
  );
  return { handled, status: res.statusCode, value: res.body ? JSON.parse(res.body) : undefined };
}

function fixture() {
  const calls: any[] = [];
  const connectorRows: any[] = [{ id: 'c1', name: 'Existing' }];
  const sessions: any = {
    list: () => [{ id: 's1' }],
    get: (id: string) => (id === 's1' ? { id, actor: 'oauth:ChatGPT' } : null),
    enableYolo: (id: string) => {
      calls.push(['enableYolo', id]);
      return { yolo: true };
    },
    disableYolo: (id: string) => {
      calls.push(['disableYolo', id]);
      return { yolo: false };
    },
    revoke: (id: string) => calls.push(['revoke', id]),
    switchWorkspace: async (...args: any[]) => {
      calls.push(['switchWorkspace', ...args]);
      return { status: 'admitted' };
    },
    revokeWorkspace: (...args: any[]) => calls.push(['revokeWorkspace', ...args]),
  };
  const connectors: any = {
    list: () => connectorRows,
    create: (input: any) => {
      calls.push(['create', input]);
      const connector = { id: `c${connectorRows.length + 1}`, ...input };
      connectorRows.push(connector);
      return { connector, token: 'secret-once' };
    },
    rotate: (id: string) => {
      calls.push(['rotate', id]);
      return id === 'c1' ? 'rotated' : null;
    },
    revoke: (id: string) => calls.push(['connectorRevoke', id]),
  };
  return {
    context: {
      mcpDiagnostics: () => ({ state: 'listening' }),
      sessions,
      bootstrap: {
        listSessions: () => [{ id: 'admin-1' }],
        revokeSessionHash: (id: string) => calls.push(['revokeAdmin', id]),
      },
      connectors,
      audit: { append: (row: any) => calls.push(['audit', row]) },
    },
    calls,
    sessions,
    connectors,
  };
}

test('diagnostics session and admin-session routes cover defaults and mutations', async () => {
  const fx = fixture();
  assert.equal((await call('/api/diagnostics/mcp', 'GET', fx.context)).value.state, 'listening');
  assert.equal((await call('/api/sessions', 'GET', fx.context)).value[0].id, 's1');
  assert.equal((await call('/api/admin-sessions', 'GET', fx.context)).value[0].id, 'admin-1');
  await call('/api/sessions/s1/revoke', 'POST', fx.context);
  await call('/api/admin-sessions/admin-1/revoke', 'POST', fx.context);
  const switched = await call('/api/sessions/s1/workspace', 'POST', fx.context, {
    workspaceId: 'w2',
    profileId: 'developer',
    timeoutMs: 25,
  });
  assert.equal(switched.value.result.status, 'admitted');
  await call('/api/sessions/s1/workspace/w%202', 'DELETE', fx.context);
  assert.ok(fx.calls.some((row) => row[0] === 'revokeWorkspace' && row[2] === 'w 2'));

  assert.equal((await call('/api/diagnostics/mcp', 'GET')).value, null);
  assert.deepEqual((await call('/api/sessions', 'GET')).value, []);
  assert.deepEqual((await call('/api/admin-sessions', 'GET')).value, []);
});

test('YOLO routes enable disable reject missing sessions and surface policy errors', async () => {
  const fx = fixture();
  const enabled = await call('/api/sessions/s1/yolo', 'POST', fx.context);
  assert.equal(enabled.value.result.yolo, true);
  const disabled = await call('/api/sessions/s1/yolo', 'DELETE', fx.context);
  assert.equal(disabled.value.result.yolo, false);
  assert.deepEqual(
    fx.calls.filter((row) => row[0] === 'audit').map((row) => row[1].operation),
    ['session.yolo.enable', 'session.yolo.disable'],
  );
  assert.equal((await call('/api/sessions/missing/yolo', 'POST', fx.context)).status, 404);
  assert.equal(
    (await call('/api/sessions/missing/workspace/w1', 'DELETE', fx.context)).status,
    404,
  );

  fx.sessions.enableYolo = () => {
    throw new Error('not connector');
  };
  const rejected = await call('/api/sessions/s1/yolo', 'POST', fx.context);
  assert.equal(rejected.status, 400);
  assert.equal(rejected.value.error.code, 'YOLO_NOT_ALLOWED');
  fx.sessions.disableYolo = () => {
    throw 'disabled';
  };
  const rejectedDelete = await call('/api/sessions/s1/yolo', 'DELETE', fx.context);
  assert.match(rejectedDelete.value.error.message, /disabled/);
});

test('connector creation validates names duplicates expiry and optional binding fields', async () => {
  const fx = fixture();
  assert.equal((await call('/api/connectors', 'GET', fx.context)).value[0].name, 'Existing');
  assert.equal((await call('/api/connectors', 'POST', fx.context, { name: '   ' })).status, 400);
  assert.equal(
    (await call('/api/connectors', 'POST', fx.context, { name: 'Existing' })).status,
    409,
  );
  assert.equal(
    (await call('/api/connectors', 'POST', fx.context, { name: 'Bad', expiresAt: 'not-date' }))
      .status,
    400,
  );

  const created = await call('/api/connectors', 'POST', fx.context, {
    name: '  New  ',
    workspaceId: 12,
    profileCap: 'developer',
    expiresAt: '2030-01-01T00:00:00Z',
  });
  assert.equal(created.status, 201);
  assert.equal(created.value.name, 'New');
  assert.equal(created.value.token, 'secret-once');
  const createCall = fx.calls.find((row) => row[0] === 'create');
  assert.equal(createCall[1].workspaceId, '12');
  assert.equal(createCall[1].expiresAt, '2030-01-01T00:00:00.000Z');

  const minimal = await call('/api/connectors', 'POST', fx.context, { name: 'Minimal' });
  assert.equal(minimal.value.workspaceId, null);
  assert.equal(minimal.value.profileCap, null);
  assert.equal(
    fx.calls.filter((row) => row[0] === 'audit').at(-1)?.[1].operation,
    'connector.create',
  );
  assert.deepEqual((await call('/api/connectors', 'GET')).value, []);
});

test('connector rotate and revoke cover found missing and name fallback branches', async () => {
  const fx = fixture();
  const rotated = await call('/api/connectors/c1/rotate', 'POST', fx.context);
  assert.equal(rotated.value.token, 'rotated');
  assert.equal((await call('/api/connectors/missing/rotate', 'POST', fx.context)).status, 404);
  await call('/api/connectors/c1', 'DELETE', fx.context);
  await call('/api/connectors/missing', 'DELETE', fx.context);
  const audits = fx.calls.filter((row) => row[0] === 'audit').map((row) => row[1]);
  assert.ok(
    audits.some((row) => row.operation === 'connector.rotate' && row.target === 'Existing'),
  );
  assert.ok(
    audits.some((row) => row.operation === 'connector.revoke' && row.target === 'Existing'),
  );
  assert.ok(audits.some((row) => row.operation === 'connector.revoke' && row.target === 'missing'));
  assert.equal((await call('/api/not-session', 'GET', fx.context)).handled, false);
});
