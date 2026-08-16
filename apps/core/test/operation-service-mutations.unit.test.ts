import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OperationService,
  type AuthorizedCapabilityContext,
} from '../src/operations/operation-service.js';

function fixture(options: { capabilities?: string[]; noLease?: boolean } = {}) {
  const files = new Map<string, string>([['/a.txt', 'one\ntwo\nthree']]);
  const states: any[] = [],
    mutations: any[] = [],
    snapshots: any[] = [];
  const reads = new Map<string, any>();
  let released = 0;
  const lease: any = {
    workspaceId: 'ws-1',
    actor: 'oauth:ChatGPT',
    capabilities: options.capabilities ?? ['files.write', 'files.delete'],
  };
  const worker: any = {
    async execute({ operation }: any) {
      if (operation.kind === 'file.read') {
        const content = files.get(operation.path);
        if (content === undefined)
          return { ok: false, error: { code: 'NOT_FOUND', message: 'missing' } };
        return { ok: true, value: { path: operation.path, content, hash: `h:${content}` } };
      }
      if (operation.kind === 'file.write' || operation.kind === 'file.create') {
        files.set(operation.path, operation.content);
        return { ok: true, value: { path: operation.path, hash: `h:${operation.content}` } };
      }
      if (operation.kind === 'file.delete') {
        files.delete(operation.path);
        return { ok: true, value: { deleted: true } };
      }
      if (operation.kind === 'file.move') {
        const content = files.get(operation.from) ?? '';
        files.delete(operation.from);
        files.set(operation.to, content);
        return { ok: true, value: { from: operation.from, to: operation.to } };
      }
      throw new Error(`unexpected ${operation.kind}`);
    },
  };
  const operations: any = {
    put: (row: any) => states.push(['put', row]),
    updateState: (...args: any[]) => states.push(['state', ...args]),
  };
  const changes: any = {
    activeOrBegin: async () => ({ id: 'chg-1' }),
    snapshot: async (_session: string, _workspace: string, path: string, operationId: string) => {
      snapshots.push({ path, operationId });
      return { changeSet: { id: 'chg-1' }, snapshotPath: `.aevra/${operationId}` };
    },
    recordMutation: async (row: any) => mutations.push(row),
  };
  const service = new OperationService(
    { activeLease: () => (options.noLease ? null : lease) } as any,
    { capabilityRoots: () => [] } as any,
    worker,
    operations,
    { append: (row: any) => states.push(['audit', row]) } as any,
    { get: (_s: string, _w: string, _p: string, hash: string) => reads.get(hash) } as any,
    { acquire: async () => ({ release: () => released++ }) } as any,
  );
  service.attachChangeService(changes);
  return { service, files, states, mutations, snapshots, reads, worker, released: () => released };
}

test('write records recovery mutation audit and lock lifecycle', async () => {
  const fx = fixture();
  const result: any = await fx.service.write('s1', { path: '/a.txt', content: 'changed' });
  assert.equal(result.hash, 'h:changed');
  assert.equal(fx.files.get('/a.txt'), 'changed');
  assert.equal(fx.snapshots.length, 1);
  assert.equal(fx.mutations[0].metadata.autoMerged, false);
  assert.equal(fx.released(), 1);
  assert.ok(fx.states.some((row) => row[0] === 'audit'));
  assert.ok(fx.states.some((row) => row[2] === 'SUCCEEDED'));
});

test('write covers stale-base merge conflict and worker errors', async () => {
  const missing = fixture();
  await assert.rejects(
    () => missing.service.write('s1', { path: '/a.txt', content: 'x', expectedHash: 'old' }),
    (e: any) => e.code === 'WRITE_CONFLICT',
  );

  const base = 'one\ntwo\nthree';
  const merged = fixture();
  merged.reads.set(`h:${base}`, { content: base });
  merged.files.set('/a.txt', 'ONE\ntwo\nthree');
  await merged.service.write('s1', {
    path: '/a.txt',
    content: 'one\ntwo\nTHREE',
    expectedHash: `h:${base}`,
  });
  assert.equal(merged.files.get('/a.txt'), 'ONE\ntwo\nTHREE');
  assert.equal(merged.mutations[0].metadata.autoMerged, true);

  const conflict = fixture();
  conflict.reads.set(`h:${base}`, { content: base });
  conflict.files.set('/a.txt', 'ONE\ntwo\nthree');
  await assert.rejects(
    () =>
      conflict.service.write('s1', {
        path: '/a.txt',
        content: 'OTHER\ntwo\nthree',
        expectedHash: `h:${base}`,
      }),
    (e: any) => e.code === 'MERGE_CONFLICT' && Array.isArray(e.ranges),
  );

  const readFailure = fixture();
  readFailure.worker.execute = async () => ({
    ok: false,
    error: { code: 'READ_FAILED', message: 'cannot read' },
  });
  await assert.rejects(
    () => readFailure.service.write('s1', { path: '/a.txt', content: 'x' }),
    (e: any) => e.code === 'READ_FAILED',
  );

  const writeFailure = fixture();
  const original = writeFailure.worker.execute.bind(writeFailure.worker);
  let calls = 0;
  writeFailure.worker.execute = async (input: any) =>
    ++calls === 2
      ? { ok: false, error: { code: 'WRITE_FAILED', message: 'cannot write' } }
      : original(input);
  await assert.rejects(
    () => writeFailure.service.write('s1', { path: '/a.txt', content: 'x' }),
    (e: any) => e.code === 'WRITE_FAILED',
  );
  assert.equal(writeFailure.released(), 1);
  assert.ok(writeFailure.states.some((row) => row[2] === 'FAILED'));
});

test('create delete move and patch exercise mutation helpers', async () => {
  const fx = fixture();
  await fx.service.create('s1', { path: '/new.txt', content: 'new', encoding: 'utf8' });
  await fx.service.move('s1', { from: '/new.txt', to: '/moved.txt' });
  await fx.service.delete('s1', { path: '/moved.txt', recursive: false });
  assert.equal(fx.files.has('/moved.txt'), false);
  assert.deepEqual(
    fx.mutations.map((row) => row.metadata.kind),
    ['create', 'move', 'delete'],
  );

  await fx.service.patch('s1', {
    path: '/a.txt',
    patch: '@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three',
  });
  assert.equal(fx.files.get('/a.txt'), 'one\nTWO\nthree');

  const stale = fixture();
  stale.reads.set('old', { content: 'alpha\nbeta' });
  stale.files.set('/a.txt', 'server\nbeta');
  await stale.service.patch('s1', {
    path: '/a.txt',
    expectedHash: 'old',
    patch: '@@ -1,2 +1,2 @@\n alpha\n-beta\n+BETA',
  });
  assert.equal(stale.files.get('/a.txt'), 'server\nBETA');
});

test('mutation helpers surface worker and patch conflicts while releasing locks', async () => {
  for (const kind of ['create', 'delete', 'move'] as const) {
    const fx = fixture();
    fx.worker.execute = async () => ({
      ok: false,
      error: { code: 'MUTATION_FAILED', message: `${kind} failed` },
    });
    const action =
      kind === 'create'
        ? () => fx.service.create('s1', { path: '/x', content: 'x', encoding: 'utf8' })
        : kind === 'delete'
          ? () => fx.service.delete('s1', { path: '/a.txt', recursive: true })
          : () => fx.service.move('s1', { from: '/a.txt', to: '/b.txt' });
    await assert.rejects(action, (e: any) => e.code === 'MUTATION_FAILED');
    assert.equal(fx.released(), 1);
    assert.ok(fx.states.some((row) => row[2] === 'FAILED'));
  }

  const noBase = fixture();
  await assert.rejects(
    () =>
      noBase.service.patch('s1', {
        path: '/a.txt',
        expectedHash: 'old',
        patch: '@@ -1 +1 @@\n-one\n+ONE',
      }),
    (e: any) => e.code === 'WRITE_CONFLICT',
  );
  const bad = fixture();
  await assert.rejects(
    () => bad.service.patch('s1', { path: '/a.txt', patch: '@@ -1 +1 @@\n-nope\n+yes' }),
    (e: any) => e.code === 'WRITE_CONFLICT',
  );
});

test('mutation authorization requires recovery lease or exact delegated capability', async () => {
  const notReady = fixture();
  notReady.service.setRecoveryReady(false);
  await assert.rejects(
    () => notReady.service.create('s1', { path: '/x', content: 'x', encoding: 'utf8' }),
    (e: any) => e.code === 'CAPABILITY_REQUIRED',
  );
  const noLease = fixture({ noLease: true });
  await assert.rejects(
    () => noLease.service.create('s1', { path: '/x', content: 'x', encoding: 'utf8' }),
    (e: any) => e.code === 'SESSION_WORKSPACE_REQUIRED',
  );
  const delegated = fixture({ capabilities: [] });
  const auth: AuthorizedCapabilityContext = {
    sessionId: 's1',
    workspaceId: 'ws-1',
    actor: 'oauth:ChatGPT',
    capability: 'files.write',
    matcher: '*',
  };
  await delegated.service.create('s1', { path: '/x', content: 'ok', encoding: 'utf8' }, auth);
  assert.equal(delegated.files.get('/x'), 'ok');
  await assert.rejects(
    () => delegated.service.delete('s1', { path: '/x', recursive: false }, auth),
    (e: any) => e.code === 'CAPABILITY_REQUIRED',
  );
  const noChanges = fixture();
  (noChanges.service as any).changes = undefined;
  noChanges.service.setRecoveryReady(true);
  await assert.rejects(
    () => noChanges.service.create('s1', { path: '/x', content: 'x', encoding: 'utf8' }),
    (e: any) => e.code === 'RECOVERY_REQUIRED',
  );
});
