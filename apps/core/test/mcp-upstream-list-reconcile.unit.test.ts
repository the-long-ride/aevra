import assert from 'node:assert/strict';
import test from 'node:test';
import type { UpstreamCatalog } from '../../../packages/mcp-upstream/src/protocol.js';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { ListReconciler } from '../src/mcp-upstream/list-reconciler.js';
import { UpstreamRegistryService } from '../src/mcp-upstream/upstream-registry-service.js';
import { UpstreamRepository } from '../src/mcp-upstream/upstream-repository.js';
import { catalogWith, harness, input, vault } from './mcp-upstream-registry-service.fixture.js';

const withNewTool: UpstreamCatalog = {
  tools: [
    { name: 'echo', description: 'Echoes text', inputSchema: { type: 'object' } },
    { name: 'shout', description: 'Shouts text', inputSchema: { type: 'object' } },
  ],
  resources: [],
  prompts: [],
};

function never(): Promise<void> {
  return new Promise<void>(() => {});
}

test('settle resolves after run when run is fast', async () => {
  let runs = 0;
  const reconciler = new ListReconciler(async () => {
    runs += 1;
  });
  await reconciler.settle();
  assert.equal(runs, 1);
});

test('settle resolves at timeout when run hangs', async () => {
  const reconciler = new ListReconciler(never, 20);
  const started = Date.now();
  await reconciler.settle();
  assert.ok(Date.now() - started < 500);
});

test('concurrent settle shares one run', async () => {
  let runs = 0;
  const reconciler = new ListReconciler(() => {
    runs += 1;
    return never();
  }, 20);
  await Promise.all([reconciler.settle(), reconciler.settle()]);
  assert.equal(runs, 1);
});

test('settle swallows run rejection', async () => {
  let runs = 0;
  const reconciler = new ListReconciler(async () => {
    runs += 1;
    throw new Error('boom');
  });
  await reconciler.settle();
  await reconciler.settle();
  assert.equal(runs, 2);
});

test('list reconcile flips changed catalog to needs-review', async () => {
  const { db, service, setCatalog, setListChangedAt } = harness();
  try {
    const record = await service.register(input);
    setCatalog(withNewTool);
    setListChangedAt('2026-10-16T00:00:01.000Z');
    await service.reconcileForList();
    const after = service.get(record.id);
    assert.equal(after?.state, 'needs-review');
    assert.deepEqual(after?.pendingCatalogDiff?.added, ['tool:shout']);
  } finally {
    db.close();
  }
});

test('failed list reconcile is not retried', async () => {
  const { db, service, calls, setFailure, setListChangedAt } = harness();
  try {
    await service.register(input);
    const before = calls.filter((entry) => entry.startsWith('connect:')).length;
    setFailure(new Error('upstream down'));
    setListChangedAt('2026-10-16T00:00:01.000Z');
    await service.reconcileForList();
    await service.reconcileForList();
    const attempts = calls.filter((entry) => entry.startsWith('connect:')).length - before;
    assert.equal(attempts, 1);
  } finally {
    db.close();
  }
});

test('call-path reconcile still retries', async () => {
  const { db, service, calls, setFailure, setListChangedAt } = harness();
  try {
    await service.register(input);
    const before = calls.filter((entry) => entry.startsWith('connect:')).length;
    setFailure(new Error('upstream down'));
    setListChangedAt('2026-10-16T00:00:01.000Z');
    await service.reconcileChanged();
    await service.reconcileChanged();
    const attempts = calls.filter((entry) => entry.startsWith('connect:')).length - before;
    assert.equal(attempts, 2);
  } finally {
    db.close();
  }
});

test('hung worker status: list returns within timeout and shares one reconcile', async () => {
  const db = AevraDatabase.open(':memory:');
  let hang = false;
  let statusCalls = 0;
  const service = new UpstreamRegistryService({
    repository: new UpstreamRepository(db.raw()),
    secrets: vault,
    worker: {
      connect: async () => {},
      catalog: async () => catalogWith('Echoes text'),
      disconnect: async () => {},
      status: () => {
        statusCalls += 1;
        return hang ? never().then(() => null) : Promise.resolve(null);
      },
      call: async () => ({}),
    },
    now: () => new Date('2026-10-16T00:00:00.000Z'),
    listReconcileTimeoutMs: 20,
  });
  try {
    await service.register(input);
    hang = true;
    const started = Date.now();
    await service.reconcileForList();
    await service.reconcileForList();
    assert.ok(Date.now() - started < 1000);
    assert.equal(statusCalls, 1);
  } finally {
    db.close();
  }
});
