import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleWorkspaceRoutes } from '../src/admin/routes/workspace-routes.js';

function request(method: string, body?: unknown) {
  const stream = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as any;
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

function workspaceContext() {
  const calls: any[] = [];
  return {
    calls,
    context: {
      workspaces: {
        listLocal: () => [{ id: 'w1', name: 'local' }],
        listRemote: () => [{ id: 'remote' }],
        create: (input: any) => {
          calls.push(['create', input]);
          return { id: 'w2', ...input };
        },
        update: (id: string, patch: any) => {
          calls.push(['update', id, patch]);
          return { id, name: patch.name };
        },
        delete: (id: string) => calls.push(['delete', id]),
        listMountsLocal: (id: string) => [{ workspaceId: id, logicalPath: '/lib' }],
        listMountsRemote: (id: string) => [{ remote: id }],
        addMount: (id: string, mount: any) => {
          calls.push(['addMount', id, mount]);
          return { workspaceId: id, ...mount };
        },
        deleteMount: (id: string) => calls.push(['deleteMount', id]),
      },
      profiles: {
        mapActor: (...args: any[]) => calls.push(['mapActor', ...args]),
      },
      localFilesystem: {
        canonicalDirectory: async (value: string) => `canonical:${value}`,
      },
    } as any,
  };
}

const BASE = 'https://localhost';

test('workspace routes list create update and delete workspaces', async () => {
  const { context, calls } = workspaceContext();

  const listed = response();
  assert.equal(
    await handleWorkspaceRoutes(request('GET'), listed, new URL(`${BASE}/api/workspaces`), context),
    true,
  );
  assert.deepEqual(JSON.parse(listed.body), [{ id: 'w1', name: 'local' }]);

  const created = request('POST', { name: 'extra', hostRoot: 'F:/ws/extra', extra: true });
  const createdRes = response();
  assert.equal(
    await handleWorkspaceRoutes(created, createdRes, new URL(`${BASE}/api/workspaces`), context),
    true,
  );
  assert.equal(createdRes.statusCode, 200);
  assert.deepEqual(calls.find((row) => row[0] === 'create')[1], {
    name: 'extra',
    description: '',
    hostRoot: 'canonical:F:/ws/extra',
  });
  assert.equal(JSON.parse(createdRes.body).workspace.id, 'w2');

  const patched = request('PATCH', { name: 'renamed' });
  const patchedRes = response();
  assert.equal(
    await handleWorkspaceRoutes(patched, patchedRes, new URL(`${BASE}/api/workspaces/w1`), context),
    true,
  );
  assert.deepEqual(
    calls.find((row) => row[0] === 'update'),
    ['update', 'w1', { name: 'renamed' }],
  );

  const deleted = response();
  assert.equal(
    await handleWorkspaceRoutes(
      request('DELETE'),
      deleted,
      new URL(`${BASE}/api/workspaces/w1`),
      context,
    ),
    true,
  );
  assert.deepEqual(JSON.parse(deleted.body).ok, true);
  assert.deepEqual(
    calls.find((row) => row[0] === 'delete'),
    ['delete', 'w1'],
  );
});

test('workspace listing falls back to remote then empty without services', async () => {
  const remoteOnly = response();
  await handleWorkspaceRoutes(request('GET'), remoteOnly, new URL(`${BASE}/api/workspaces`), {
    workspaces: { listRemote: () => [{ id: 'remote' }] },
  } as any);
  assert.deepEqual(JSON.parse(remoteOnly.body), [{ id: 'remote' }]);

  const none = response();
  await handleWorkspaceRoutes(request('GET'), none, new URL(`${BASE}/api/workspaces`), {} as any);
  assert.deepEqual(JSON.parse(none.body), []);
});

test('workspace mount routes cover local remote fallback add and delete', async () => {
  const { context, calls } = workspaceContext();

  const local = response();
  await handleWorkspaceRoutes(
    request('GET'),
    local,
    new URL(`${BASE}/api/workspaces/w1/mounts`),
    context,
  );
  assert.deepEqual(JSON.parse(local.body), [{ workspaceId: 'w1', logicalPath: '/lib' }]);

  const remoteFallback = {
    workspaces: { listMountsRemote: (id: string) => [{ remote: id }] },
  } as any;
  const fellBack = response();
  await handleWorkspaceRoutes(
    request('GET'),
    fellBack,
    new URL(`${BASE}/api/workspaces/w9/mounts`),
    remoteFallback,
  );
  assert.deepEqual(JSON.parse(fellBack.body), [{ remote: 'w9' }]);

  const none = response();
  await handleWorkspaceRoutes(
    request('GET'),
    none,
    new URL(`${BASE}/api/workspaces/w9/mounts`),
    {} as any,
  );
  assert.deepEqual(JSON.parse(none.body), []);

  const added = request('POST', {
    logicalPath: '/data',
    hostRoot: 'F:/data',
    capabilities: ['files.read'],
    sensitivityPolicyId: 'sp1',
  });
  const addedRes = response();
  assert.equal(
    await handleWorkspaceRoutes(
      added,
      addedRes,
      new URL(`${BASE}/api/workspaces/w1/mounts`),
      context,
    ),
    true,
  );
  assert.deepEqual(calls.find((row) => row[0] === 'addMount')[2], {
    logicalPath: '/data',
    hostRoot: 'F:/data',
    capabilities: ['files.read'],
    sensitivityPolicyId: 'sp1',
  });

  const minimal = request('POST', { logicalPath: '/x', hostRoot: 'F:/x' });
  const minimalRes = response();
  await handleWorkspaceRoutes(
    minimal,
    minimalRes,
    new URL(`${BASE}/api/workspaces/w1/mounts`),
    context,
  );
  assert.deepEqual(calls.filter((row) => row[0] === 'addMount').at(-1)[2].capabilities, []);

  const removed = response();
  assert.equal(
    await handleWorkspaceRoutes(
      request('DELETE'),
      removed,
      new URL(`${BASE}/api/mounts/m1`),
      context,
    ),
    true,
  );
  assert.deepEqual(
    calls.find((row) => row[0] === 'deleteMount'),
    ['deleteMount', 'm1'],
  );
});

test('workspace admission route maps actors with ask auto and defaults', async () => {
  const { context, calls } = workspaceContext();

  const ask = request('POST', { actor: 'oauth:chatgpt', profileId: 'reviewer', admission: 'ask' });
  assert.equal(
    await handleWorkspaceRoutes(
      ask,
      response(),
      new URL(`${BASE}/api/workspaces/w1/admission`),
      context,
    ),
    true,
  );

  const auto = request('POST', { actor: 'bearer:x' });
  await handleWorkspaceRoutes(
    auto,
    response(),
    new URL(`${BASE}/api/workspaces/w2/admission`),
    context,
  );

  const mapped = calls.filter((row) => row[0] === 'mapActor');
  assert.deepEqual(mapped, [
    ['mapActor', 'oauth:chatgpt', 'w1', 'reviewer', 'ask'],
    ['mapActor', 'bearer:x', 'w2', 'developer', 'auto'],
  ]);
});

test('workspace routes reject unmatched paths and methods', async () => {
  const { context } = workspaceContext();
  for (const [method, url] of [
    ['POST', `${BASE}/api/workspaces/w1`],
    ['PUT', `${BASE}/api/workspaces`],
    ['GET', `${BASE}/api/mounts/m1`],
    ['PATCH', `${BASE}/api/workspaces/w1/admission`],
    ['GET', `${BASE}/api/other`],
  ] as const) {
    assert.equal(
      await handleWorkspaceRoutes(request(method), response(), new URL(url), context),
      false,
    );
  }
});
