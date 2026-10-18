import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, input } from './mcp-upstream-registry-service.fixture.js';

const connectsOf = (calls: string[]) => calls.filter((entry) => entry.startsWith('connect:'));
const disconnectsOf = (calls: string[]) => calls.filter((entry) => entry.startsWith('disconnect:'));
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('a failed enabling edit does not reconnect a disabled server', async () => {
  const { db, service, calls, setNextFailure } = harness();
  try {
    const record = await service.register(input);
    await service.setEnabled(record.id, false);
    const connects = connectsOf(calls).length;
    setNextFailure(new Error('refused'));
    await assert.rejects(
      service.update(record.id, { enabled: true, config: { url: 'https://new.a.test/mcp' } }),
      /MCP_UPSTREAM_HANDSHAKE_FAILED/,
    );
    assert.equal(connectsOf(calls).length, connects + 1);
    assert.equal(service.get(record.id)?.enabled, false);
  } finally {
    db.close();
  }
});

test('a disconnect failure is reported as a warning, not hidden', async () => {
  const { db, service, setDisconnectFailure } = harness();
  try {
    const record = await service.register(input);
    setDisconnectFailure(new Error('worker gone'));
    const toggled = await service.setEnabled(record.id, false);
    assert.equal(toggled.record.enabled, false);
    assert.match(toggled.warning ?? '', /could not be closed: .*worker gone/);
    await service.setEnabled(record.id, true);
    const edited = await service.updateReporting(record.id, { enabled: false });
    assert.equal(edited.changed, true);
    assert.match(edited.warning ?? '', /could not be closed/);
  } finally {
    db.close();
  }
});

test('disabling is not held up by an in-flight refresh', async () => {
  const { db, service, calls, pauseNextCatalog } = harness();
  try {
    const record = await service.register(input);
    const gate = pauseNextCatalog();
    const refreshing = service.refresh(record.id).catch(() => null);
    await gate.started;
    const timeout = new Promise((resolve) => setTimeout(() => resolve('blocked'), 1000));
    const toggled = await Promise.race([service.setEnabled(record.id, false), timeout]);
    assert.notEqual(toggled, 'blocked');
    assert.equal(service.get(record.id)?.enabled, false);
    const disconnects = disconnectsOf(calls).length;
    gate.release();
    await refreshing;
    await settle();
    assert.equal(disconnectsOf(calls).length, disconnects + 1);
    assert.deepEqual(service.serving(), []);
  } finally {
    db.close();
  }
});

test('an edit while disabled is degraded, and enabling verifies it', async () => {
  const { db, service, calls, connectedConfig } = harness();
  try {
    const record = await service.register(input);
    await service.setEnabled(record.id, false);
    const edited = await service.update(record.id, { config: { url: 'https://new.a.test/mcp' } });
    assert.equal(edited.state, 'degraded');
    const connects = connectsOf(calls).length;
    const enabled = await service.setEnabled(record.id, true);
    assert.equal(enabled.warning, undefined);
    assert.equal(enabled.record.state, 'active');
    assert.equal(connectsOf(calls).length, connects + 1);
    assert.equal((connectedConfig() as { url?: string } | null)?.url, 'https://new.a.test/mcp');
  } finally {
    db.close();
  }
});

test('enabling an unreachable degraded server succeeds with a warning', async () => {
  const { db, service, setFailure } = harness();
  try {
    const record = await service.register(input);
    await service.setEnabled(record.id, false);
    await service.update(record.id, { config: { url: 'https://new.a.test/mcp' } });
    setFailure(new Error('down'));
    const enabled = await service.setEnabled(record.id, true);
    assert.equal(enabled.changed, true);
    assert.equal(enabled.record.enabled, true);
    assert.equal(enabled.record.state, 'degraded');
    assert.match(enabled.warning ?? '', /MCP_UPSTREAM_UNREACHABLE/);
    assert.deepEqual(service.serving(), []);
  } finally {
    db.close();
  }
});

test('an older enabling update cannot undo a completed disable or publish its catalog', async () => {
  const { db, service, pauseNextCatalog } = harness();
  try {
    const record = await service.register(input);
    const gate = pauseNextCatalog();
    const updating = service.update(record.id, {
      enabled: true,
      config: { url: 'https://new.a.test/mcp' },
    });
    await gate.started;
    await service.setEnabled(record.id, false);
    gate.release();
    await updating;
    await settle();
    assert.equal(service.get(record.id)?.enabled, false);
    assert.deepEqual(service.serving(), []);
    assert.deepEqual(service.get(record.id)?.config, record.config);
  } finally {
    db.close();
  }
});

test('disable during failed-update restoration prevents stale catalog publication', async () => {
  const { db, service, pauseNextCatalog, setNextFailure, setCatalog } = harness();
  try {
    const record = await service.register(input);
    setCatalog({ tools: [{ name: 'replacement' }], resources: [], prompts: [] });
    setNextFailure(new Error('new config refused'));
    const gate = pauseNextCatalog();
    const updating = service
      .update(record.id, { config: { url: 'https://new.a.test/mcp' } })
      .catch((error) => error);
    await gate.started;
    await service.setEnabled(record.id, false);
    gate.release();
    await updating;
    await settle();
    assert.equal(service.get(record.id)?.enabled, false);
    assert.equal(service.get(record.id)?.pendingCatalog, null);
    assert.deepEqual(service.cachedCatalog(record.id), record.catalog);
  } finally {
    db.close();
  }
});

test('disable then re-enable still cancels the older configuration update', async () => {
  const { db, service, pauseNextCatalog } = harness();
  try {
    const record = await service.register(input);
    const gate = pauseNextCatalog();
    const updating = service.update(record.id, {
      enabled: true,
      config: { url: 'https://stale.a.test/mcp' },
    });
    await gate.started;
    await service.setEnabled(record.id, false);
    await service.setEnabled(record.id, true);
    gate.release();
    await updating;
    await settle();
    assert.equal(service.get(record.id)?.enabled, true);
    assert.deepEqual(service.get(record.id)?.config, record.config);
  } finally {
    db.close();
  }
});

test('persisted legacy catalog hashes require review after refresh', async () => {
  const { db, service } = harness();
  try {
    const record = await service.register(input);
    db.raw()
      .prepare('UPDATE mcp_upstreams SET catalog_fingerprint=? WHERE id=?')
      .run('legacy-fingerprint', record.id);
    const result = await service.refresh(record.id);
    assert.equal(result.changed, true);
    assert.equal(result.record.state, 'needs-review');
    assert.deepEqual(service.serving(), []);
  } finally {
    db.close();
  }
});
