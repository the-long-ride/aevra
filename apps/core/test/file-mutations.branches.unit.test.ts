import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createFileMutation,
  deleteFileMutation,
  moveFileMutation,
  patchFileMutation,
} from '../src/operations/file-mutations.js';

const lease: any = { workspaceId: 'ws-1' };

function deps(worker: (op: any) => any) {
  const states: Array<[string, unknown?]> = [];
  const puts: any[] = [];
  const mutations: any[] = [];
  let released = 0;
  const reads = new Map<string, { content: string }>();
  const value = {
    workspaces: { capabilityRoots: () => [{ id: 'root' }] },
    worker: { execute: async (input: any) => worker(input.operation) },
    operations: {
      put: (record: any) => puts.push(record),
      updateState: (_id: string, state: string, detail?: unknown) => states.push([state, detail]),
    },
    locks: { acquire: async () => ({ release: () => void released++ }) },
    changes: {
      activeOrBegin: async () => ({ id: 'cs-active' }),
      snapshot: async () => ({ snapshotPath: 'snap/1', changeSet: { id: 'cs-snap' } }),
      recordMutation: async (record: any) => void mutations.push(record),
    },
    reads: { get: (_s: string, _w: string, p: string, hash: string) => reads.get(`${p}@${hash}`) },
  };
  return { value: value as any, states, puts, mutations, reads, released: () => released };
}

const okWorker = (extra: Record<string, unknown> = {}) => () => ({ ok: true, value: { hash: 'h-after', ...extra } });
const failWorker = () => ({ ok: false, error: { code: 'WORKER_FAIL', message: 'worker words' } });

test('create records the mutation and walks operation states to success', async () => {
  const d = deps(okWorker());
  const result = await createFileMutation(d.value, 's', lease, { path: 'a.txt', content: 'text', encoding: 'utf8' });
  assert.deepEqual(result, { hash: 'h-after' });
  assert.deepEqual(d.states.map(([s]) => s), ['AUTHORIZED', 'EXECUTING', 'SUCCEEDED']);
  assert.equal(d.puts[0].kind, 'file.create');
  assert.deepEqual(d.mutations[0], {
    changeSetId: 'cs-active',
    operationId: d.puts[0].id,
    logicalPath: 'a.txt',
    afterHash: 'h-after',
    metadata: { kind: 'create' },
  });
  assert.equal(d.released(), 1);
});

test('create, delete, and move mark failures, keep codes, and release locks', async () => {
  for (const run of [
    (d: any) => createFileMutation(d, 's', lease, { path: 'a', content: '', encoding: 'utf8' }),
    (d: any) => deleteFileMutation(d, 's', lease, { path: 'a', recursive: false }),
    (d: any) => moveFileMutation(d, 's', lease, { from: 'a', to: 'b' }),
  ]) {
    const d = deps(failWorker);
    await assert.rejects(() => run(d.value), (error: any) => error.code === 'WORKER_FAIL' && error.message === 'worker words');
    assert.deepEqual(d.states.at(-1), ['FAILED', { message: 'worker words' }]);
    assert.equal(d.released(), 1);
    const thrower = deps(() => {
      throw 'plain string';
    });
    await assert.rejects(() => run(thrower.value));
    assert.deepEqual(thrower.states.at(-1), ['FAILED', { message: 'plain string' }]);
  }
});

test('delete and move snapshot first and record recovery metadata', async () => {
  const del = deps(okWorker());
  await deleteFileMutation(del.value, 's', lease, { path: 'dir', recursive: true });
  assert.deepEqual(del.states[0], ['AUTHORIZED', { snapshotPath: 'snap/1' }]);
  assert.deepEqual(del.mutations[0].metadata, { kind: 'delete' });
  assert.equal(del.mutations[0].changeSetId, 'cs-snap');
  const move = deps(okWorker());
  await moveFileMutation(move.value, 's', lease, { from: 'a', to: 'b' });
  assert.deepEqual(move.mutations[0].metadata, { kind: 'move', to: 'b' });
  assert.equal(move.mutations[0].snapshotPath, 'snap/1');
});

function patcher(content: string, hash = 'h1') {
  const d = deps((op) => (op.kind === 'file.read' ? { ok: true, value: { content, hash, path: 'f.txt' } } : failWorker()));
  const writes: Array<[string, string]> = [];
  const run = (patch: string, expectedHash?: string) =>
    patchFileMutation(d.value, 's', lease, { path: 'f.txt', patch, expectedHash }, async (text, h) => {
      writes.push([text, h]);
      return 'written';
    });
  return { d, writes, run };
}

test('patch applies multiple hunks with offsets and keeps CRLF endings', async () => {
  const { writes, run } = patcher('one\r\ntwo\r\nthree\r\nfour\r\nfive');
  const patch = ['--- a', '+++ b', '@@ -1,2 +1,3 @@', ' one', '+inserted', ' two', '@@ -4 +5 @@', '-four', '+FOUR', 'noise'].join('\n');
  assert.equal(await run(patch), 'written');
  assert.deepEqual(writes[0], ['one\r\ninserted\r\ntwo\r\nthree\r\nFOUR\r\nfive', 'h1']);
});

test('patch rejects mismatched context, missing hunks, and failed reads', async () => {
  const { run } = patcher('alpha\nbeta');
  await assert.rejects(() => run('@@ -1 +1 @@\n-gamma\n+delta'), (e: any) => e.code === 'WRITE_CONFLICT');
  await assert.rejects(() => run('-alpha\n+delta'), (e: any) => e.code === 'INVALID_REQUEST');
  const failing = deps(failWorker);
  await assert.rejects(
    () => patchFileMutation(failing.value, 's', lease, { path: 'f', patch: '' }, async () => null),
    (e: any) => e.code === 'WORKER_FAIL',
  );
});

test('patch against a stale hash uses the cached read or reports a conflict', async () => {
  const { d, writes, run } = patcher('current\ntext', 'h-new');
  await assert.rejects(() => run('@@ -1 +1 @@\n-old\n+next', 'h-old'), /Stale patch base unavailable/);
  d.reads.set('f.txt@h-old', { content: 'old\ntext' });
  await run('@@ -1 +1 @@\n-old\n+next', 'h-old');
  assert.deepEqual(writes[0], ['next\ntext', 'h-old']);
  await run('@@ -1 +1 @@\n-current\n+again', 'h-new');
  assert.deepEqual(writes[1], ['again\ntext', 'h-new']);
});
