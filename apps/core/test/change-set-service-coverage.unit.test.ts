import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ChangeSetService } from '../src/changes/change-service.js';

function fakeDb(
  options: {
    sets?: any[];
    operations?: any[];
    missingDb?: boolean;
  } = {},
) {
  const calls: any[] = [];
  const sets = options.sets ?? [];
  const operations = options.operations ?? [];
  const db = options.missingDb
    ? undefined
    : {
        prepare(query: string) {
          if (query.startsWith('SELECT * FROM change_sets ORDER BY'))
            return { all: () => sets.map((r) => ({ ...r })) };
          if (query.startsWith('SELECT * FROM change_sets WHERE id=?')) {
            return {
              get: (id: string) => {
                const row = sets.find((r) => r.id === id);
                return row ? { ...row } : undefined;
              },
            };
          }
          if (query.includes('FROM change_operations'))
            return {
              all: () => operations.map((r) => ({ ...r })).sort((a, b) => b.id - a.id),
            };
          return {
            run: (...args: any[]) => calls.push([query, ...args]),
          };
        },
      };
  return { calls, db };
}

interface HarnessOptions {
  db?: ReturnType<typeof fakeDb>;
  reads?: Array<{ ok: boolean; value?: any; error?: any }>;
}

async function harness(options: HarnessOptions = {}) {
  const recoveryDir = await mkdtemp(path.join(os.tmpdir(), 'aevra-changes-'));
  const storage = options.db ?? fakeDb();
  const workerOps: any[] = [];
  let readIndex = 0;
  const worker = {
    execute: async (input: any) => {
      workerOps.push(input.operation);
      if (input.operation.kind === 'recovery.snapshot')
        return { ok: true, value: { sizeBytes: 10 } };
      if (input.operation.kind === 'file.read') {
        const scripted = options.reads?.[readIndex++];
        if (scripted) return scripted;
        return { ok: false, error: { code: 'NOT_FOUND', message: 'missing' } };
      }
      return { ok: true, value: {} };
    },
  };
  const service = new ChangeSetService(
    { put: () => {}, record: () => {} } as any,
    {
      incomplete: () => [{ id: 'op1' }, { id: 'op2' }],
      updateState: (id: string, state: string, meta: any) =>
        (storage.calls as any[]).push(['updateState', id, state, meta]),
    } as any,
    { capabilityRoots: () => [] } as any,
    worker as any,
    recoveryDir,
  );
  // Inject the fake database the list/status/rename/commit/rollback helpers consult.
  (service as any).changes.db = storage.db;
  return { service, workerOps, calls: storage.calls as any[], recoveryDir };
}

test('status rename commit and list surface repository rows when a db exists', async () => {
  const { service, calls } = await harness({
    db: fakeDb({
      sets: [
        { id: 'c1', owner_session_id: 's1', workspace_id: 'w1', name: 'before' },
        { id: 'c2', owner_session_id: 'other' },
      ],
    }),
  });

  assert.equal(service.status('c1').name, 'before');
  assert.equal(service.status('c1', 'wrong-session'), null);
  assert.equal(service.status('missing'), null);
  assert.deepEqual(
    service.list().map((row: any) => row.id),
    ['c1', 'c2'],
  );

  assert.equal(service.rename('c1', 'after')?.name, 'before');
  assert.ok(calls.some(([query]) => query.includes('SET name=?')));

  await service.commit('c1');
  assert.ok(
    calls.some(([query, , id]) => String(query).includes("state='COMMITTED'") && id === 'c1'),
  );
});

test('helpers degrade gracefully without a repository database', async () => {
  const { service } = await harness({ db: fakeDb({ missingDb: true }) });
  assert.deepEqual(service.list(), []);
  assert.equal(service.status('c1'), null);
  assert.equal(service.rename('c1', 'x'), null);
  await service.commit('c1');
  assert.deepEqual(await service.rollback('c1', { force: false, skipPaths: [] }), {
    kind: 'conflict',
    paths: ['repository unavailable'],
  });
});

test('rollback deletes creates restores snapshots skips paths and reports conflicts', async () => {
  const base = { owner_session_id: 's1', workspace_id: 'w1', state: 'OPEN' };
  const { service, workerOps } = await harness({
    db: fakeDb({
      sets: [{ ...base, id: 'c1' }],
      operations: [
        {
          id: 3,
          logical_path: '/created.txt',
          after_hash: 'hash-created',
          metadata_json: JSON.stringify({ kind: 'create' }),
        },
        {
          id: 2,
          logical_path: '/moved.txt',
          after_hash: 'hash-moved',
          snapshot_path: '/snap/moved',
          metadata_json: JSON.stringify({ kind: 'move', to: '/renamed.txt' }),
        },
        {
          id: 1,
          logical_path: '/edited.txt',
          after_hash: 'hash-edited',
          snapshot_path: '/snap/edited',
          metadata_json: JSON.stringify({ kind: 'write' }),
        },
        {
          id: 0,
          logical_path: '/skipped.txt',
          metadata_json: JSON.stringify({ kind: 'create' }),
        },
      ],
    }),
    reads: [
      // created.txt now differs -> conflict without force
      { ok: true, value: { hash: 'drifted' } },
      // moved.txt matches its after hash
      { ok: true, value: { hash: 'hash-moved' } },
      // edited.txt read fails -> treated as restorable
      { ok: false, error: { code: 'NOT_FOUND', message: 'gone' } },
    ],
  });

  const result = await service.rollback('c1', { force: false, skipPaths: ['/skipped.txt'] });
  assert.deepEqual(result, { kind: 'conflict', paths: ['/created.txt'] });
  assert.deepEqual(
    workerOps.map((op) => op.kind),
    ['file.read', 'file.delete', 'file.read', 'recovery.restore', 'file.read', 'recovery.restore'],
  );
});

test('rollback with force removes drifted creates and marks the set rolled back', async () => {
  const { service, workerOps, calls } = await harness({
    db: fakeDb({
      sets: [{ id: 'c1', owner_session_id: 's1', workspace_id: 'w1', state: 'OPEN' }],
      operations: [
        {
          id: 1,
          logical_path: '/created.txt',
          after_hash: 'hash-created',
          metadata_json: JSON.stringify({ kind: 'create' }),
        },
        {
          id: 0,
          logical_path: '/plain.txt',
          metadata_json: JSON.stringify({ kind: 'write' }),
          snapshot_path: '',
        },
      ],
    }),
    reads: [{ ok: true, value: { hash: 'drifted' } }],
  });

  assert.deepEqual(await service.rollback('c1', { force: true, skipPaths: [] }), {
    kind: 'rolled-back',
  });
  assert.deepEqual(
    workerOps.map((op) => op.kind),
    ['file.read', 'file.delete'],
  );
  assert.ok(calls.some(([query]) => String(query).includes("state='ROLLED_BACK'")));
});

test('rollback refuses unknown change sets and move mutations delete their destination', async () => {
  const { service, workerOps } = await harness({
    db: fakeDb({
      sets: [{ id: 'c1', owner_session_id: 's1', workspace_id: 'w1', state: 'OPEN' }],
      operations: [
        {
          id: 1,
          logical_path: '/src.txt',
          metadata_json: JSON.stringify({ kind: 'move', to: '/dst.txt' }),
        },
      ],
    }),
  });
  await assert.rejects(() => service.rollback('missing', { force: false, skipPaths: [] }));
  await service.rollback('c1', { force: false, skipPaths: [] });
  assert.deepEqual(
    workerOps.map((op) => op.kind),
    ['file.delete'],
  );
  assert.equal(workerOps[0].path, '/dst.txt');
});

test('record mutation reconciliation and cached active sets delegate correctly', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-change-records-'));
  try {
    const recorded: any[] = [];
    const storage = fakeDb();
    const service = new ChangeSetService(
      { put: () => {}, record: (input: any) => recorded.push(input) } as any,
      {
        incomplete: () => [],
        updateState: () => {},
      } as any,
      { capabilityRoots: () => [] } as any,
      { execute: async () => ({ ok: true, value: { sizeBytes: 1 } }) } as any,
      dir,
    );
    (service as any).changes.db = storage.db;

    await service.recordMutation({
      changeSetId: 'c1',
      operationId: 'op-1',
      logicalPath: '/a',
    });
    assert.equal(recorded[0].logicalPath, '/a');

    await service.reconcileIncompleteOperations();

    const first = await service.activeOrBegin('s1', 'w1');
    const second = await service.activeOrBegin('s1', 'w1');
    assert.equal(first.id, second.id);
    assert.notEqual(first.id, (await service.activeOrBegin('s2', 'w1')).id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
