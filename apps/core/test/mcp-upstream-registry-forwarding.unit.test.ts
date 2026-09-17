import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogWith, harness, input, vault } from './mcp-upstream-registry-service.fixture.js';
import { UpstreamRegistryService } from '../src/mcp-upstream/upstream-registry-service.js';
import { UpstreamRepository } from '../src/mcp-upstream/upstream-repository.js';

test('a recreated registry reconnects a persisted active upstream before forwarding', async () => {
  const { db, service } = harness();
  try {
    const record = await service.register(input);
    let connected = false;
    let forwarded = 0;
    const fresh = new UpstreamRegistryService({
      repository: new UpstreamRepository(db.raw()),
      secrets: vault,
      worker: {
        connect: async () => {
          connected = true;
        },
        catalog: async () => catalogWith('Echoes text'),
        disconnect: async () => {
          connected = false;
        },
        status: async () =>
          connected
            ? {
                upstreamId: record.id,
                state: 'connected' as const,
                server: null,
                failures: 0,
                retryAfter: null,
                lastError: null,
                listChangedAt: null,
              }
            : null,
        call: async () => {
          forwarded += 1;
          return { ok: true };
        },
      },
    });
    assert.deepEqual(await fresh.callTool('github', 'echo', {}), { ok: true });
    assert.equal(connected, true);
    assert.equal(forwarded, 1);
  } finally {
    db.close();
  }
});

test('repeated refresh keeps the diff against the approved catalog', async () => {
  const { db, service, setCatalog } = harness();
  try {
    const record = await service.register(input);
    const changed = catalogWith('Changed instructions');
    setCatalog(changed);
    await service.refresh(record.id);
    const repeated = await service.refresh(record.id);
    assert.equal(repeated.record.state, 'needs-review');
    assert.deepEqual(repeated.record.pendingCatalogDiff, {
      added: [],
      removed: [],
      changed: ['tool:echo'],
    });
    assert.deepEqual(repeated.record.pendingCatalog, changed);
  } finally {
    db.close();
  }
});

test('saving unchanged connection settings does not acknowledge catalog review', async () => {
  const { db, service, setCatalog } = harness();
  try {
    const record = await service.register(input);
    setCatalog(catalogWith('Changed instructions'));
    await service.refresh(record.id);
    const saved = await service.update(record.id, { ...input, enabled: true });
    assert.equal(saved.state, 'needs-review');
    assert.ok(saved.pendingCatalog);
  } finally {
    db.close();
  }
});

test('a failed connection edit revalidates the restored session catalog', async () => {
  const { db, service, setCatalog, setNextFailure } = harness();
  try {
    const record = await service.register(input);
    const changed = catalogWith('Changed while restoring the previous connection');
    setCatalog(changed);
    setNextFailure(new Error('new connection unavailable'));
    await assert.rejects(
      service.update(record.id, { ...input, config: { url: 'https://new.test/mcp' } }),
    );
    const restored = service.get(record.id);
    assert.equal(restored?.state, 'needs-review');
    assert.deepEqual(restored?.pendingCatalog, changed);
    assert.deepEqual(service.serving(), []);
  } finally {
    db.close();
  }
});

test('forwarding waits for an in-progress catalog validation', async () => {
  const { db, service, setCatalog, pauseNextCatalog, forwarded } = harness();
  let refresh: Promise<unknown> | null = null;
  let call: Promise<unknown> | null = null;
  try {
    const record = await service.register(input);
    setCatalog(catalogWith('Changed during refresh'));
    const gate = pauseNextCatalog();
    refresh = service.refresh(record.id);
    await gate.started;
    call = service.callTool('github', 'echo', {});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(forwarded(), 0);
    gate.release();
    await refresh;
    await assert.rejects(call, /MCP_UPSTREAM_NEEDS_REVIEW/);
    assert.equal(forwarded(), 0);
  } finally {
    if (refresh) await Promise.allSettled([refresh]);
    if (call) await Promise.allSettled([call]);
    db.close();
  }
});

test('a worker catalog notification is reconciled before the upstream is listed', async () => {
  const { db, service, setCatalog, setListChangedAt } = harness();
  try {
    const record = await service.register(input);
    setCatalog(catalogWith('Changed by notification'));
    setListChangedAt('2026-09-16T01:00:00.000Z');
    await service.reconcileChanged();
    assert.equal(service.get(record.id)?.state, 'needs-review');
    assert.deepEqual(service.serving(), []);
  } finally {
    db.close();
  }
});

test('a disabled server keeps its row but stops being served', async () => {
  const { db, service } = harness();
  try {
    const record = await service.register(input);
    assert.equal(service.serving().length, 1);
    assert.equal(service.setEnabled(record.id, false).enabled, false);
    assert.deepEqual(service.serving(), []);
    assert.equal(service.list().length, 1);
    assert.equal(service.setEnabled(record.id, true).enabled, true);
    assert.equal(service.serving().length, 1);
  } finally {
    db.close();
  }
});

test('markDegraded records the state a failing worker session reports', async () => {
  const { db, service } = harness();
  try {
    const record = await service.register(input);
    assert.equal(service.markDegraded(record.id).state, 'degraded');
    assert.deepEqual(service.serving(), []);
  } finally {
    db.close();
  }
});

test('remove disconnects the session, drops the row and drops the cache', async () => {
  const { db, service, calls } = harness();
  try {
    const record = await service.register(input);
    await service.remove(record.id);
    assert.deepEqual(service.list(), []);
    assert.equal(service.cachedCatalog(record.id), null);
    assert.ok(calls.includes(`disconnect:${record.id}`));
  } finally {
    db.close();
  }
});

test('an unknown id is a 404, not a silent no-op', async () => {
  const { db, service } = harness();
  try {
    await assert.rejects(service.refresh('mu_missing'), (error: Error & { status?: number }) => {
      assert.equal(error.status, 404);
      return true;
    });
  } finally {
    db.close();
  }
});
