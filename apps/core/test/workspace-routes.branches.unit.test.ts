import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleWorkspaceRoutes } from '../src/admin/routes/workspace-routes.js';

function request(method: string | undefined, body?: unknown) {
  const text = body === undefined ? '' : JSON.stringify(body);
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
    end(value = '') {
      result.body = String(value);
    },
  };
  return result as any;
}

async function call(context: any, path: string, method?: string, body?: unknown) {
  const res = response();
  const handled = await handleWorkspaceRoutes(request(method, body), res, new URL(`https://localhost${path}`), context);
  return { handled, status: res.statusCode, value: res.body ? JSON.parse(res.body) : undefined };
}

function fixture(processes?: any[], withSessions = true) {
  const updates: any[] = [];
  const invalidated: string[] = [];
  const context: any = {
    workspaces: {
      getLocal: (id: string) => (id === 'w1' ? { id, hostRoot: '/old' } : null),
      update: (id: string, input: any) => (updates.push([id, input]), { id, ...input }),
    },
    localFilesystem: { canonicalDirectory: async (value: string) => `/canon${value}` },
  };
  if (processes) context.processes = { listLocal: () => processes };
  if (withSessions) context.sessions = { invalidateWorkspaceAccess: (id: string) => invalidated.push(id) };
  return { context, updates, invalidated };
}

test('listing falls back from local to remote to empty', async () => {
  assert.deepEqual((await call({}, '/api/workspaces')).value, []);
  assert.deepEqual((await call({ workspaces: { listRemote: () => [{ id: 'r' }] } }, '/api/workspaces')).value, [{ id: 'r' }]);
});

test('changing the root is blocked by active processes matched by either id field', async () => {
  for (const process of [
    { workspace_id: 'w1', state: 'running' },
    { workspaceId: 'w1' },
  ]) {
    const fx = fixture([process]);
    const result = await call(fx.context, '/api/workspaces/w1', 'PATCH', { hostRoot: '/new' });
    assert.deepEqual([result.status, result.value.error.code], [409, 'WORKSPACE_PROCESS_ACTIVE']);
    assert.deepEqual(fx.updates, []);
  }
});

test('terminal or unrelated processes allow the root change and invalidate access', async () => {
  const fx = fixture([{ workspace_id: 'w1', state: 'completed' }, { workspaceId: 'w2', state: 'running' }, {}]);
  const result = await call(fx.context, '/api/workspaces/w1', 'PATCH', { hostRoot: ' /new ' });
  assert.equal(result.status, 200);
  assert.deepEqual(fx.updates, [['w1', { hostRoot: '/canon/new' }]]);
  assert.deepEqual(fx.invalidated, ['w1']);
  const noProcesses = fixture(undefined, false);
  assert.equal((await call(noProcesses.context, '/api/workspaces/w1', 'PATCH', { hostRoot: '/x' })).status, 200);
});

test('same root, null root, or unknown workspace skip the process check', async () => {
  const fx = fixture([{ workspace_id: 'w1', state: 'running' }]);
  fx.context.localFilesystem.canonicalDirectory = async (value: string) => (value ? '/old' : '');
  assert.equal((await call(fx.context, '/api/workspaces/w1', 'PATCH', { hostRoot: '/old' })).status, 200);
  assert.equal((await call(fx.context, '/api/workspaces/w1', 'PATCH', { hostRoot: null })).status, 200);
  assert.equal((await call(fx.context, '/api/workspaces/w9', 'PATCH', { hostRoot: '/x' })).status, 200);
  assert.equal((await call(fx.context, '/api/workspaces/w1', 'PATCH', { name: 'n' })).status, 200);
  assert.deepEqual(fx.invalidated, []);
  assert.deepEqual(fx.updates.map((row) => row[1]), [{ hostRoot: '/old' }, { hostRoot: '' }, { hostRoot: '/old' }, { name: 'n' }]);
});

test('mount listing prefers local, then remote, then empty', async () => {
  assert.deepEqual((await call({}, '/api/workspaces/w1/mounts')).value, []);
  const remote = { workspaces: { listMountsRemote: (id: string) => [{ id, remote: true }] } };
  assert.deepEqual((await call(remote, '/api/workspaces/w1/mounts')).value, [{ id: 'w1', remote: true }]);
});

test('mount creation defaults capabilities and admission defaults profile and mode', async () => {
  const mounts: any[] = [];
  const mapped: any[] = [];
  const context = {
    workspaces: { addMount: (id: string, input: any) => (mounts.push([id, input]), { id: 'm1' }) },
    profiles: { mapActor: (...args: any[]) => mapped.push(args) },
  };
  const mount = await call(context, '/api/workspaces/w1/mounts', 'POST', { logicalPath: '/a', hostRoot: '/b' });
  assert.equal(mount.value.mount.id, 'm1');
  assert.deepEqual(mounts[0][1].capabilities, []);
  await call(context, '/api/workspaces/w1/admission', 'POST', { actor: 'oauth:x' });
  await call(context, '/api/workspaces/w1/admission', 'POST', { actor: 'oauth:y', profileId: 'read-only', admission: 'ask' });
  assert.deepEqual(mapped, [
    ['oauth:x', 'w1', 'developer', 'auto'],
    ['oauth:y', 'w1', 'read-only', 'ask'],
  ]);
  assert.equal((await call({}, '/api/workspaces/w1/admission', 'POST', { actor: 'a' })).status, 200);
  assert.equal((await call({}, '/api/workspaces/w1/admission', 'GET')).handled, false);
});
