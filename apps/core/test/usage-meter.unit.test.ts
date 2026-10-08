import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateTokens } from '../../../packages/protocol/src/token-estimate.js';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { TokenUsageRepository } from '../../../packages/store/src/token-usage.js';
import { UsageMeter, responseFailed } from '../src/usage/usage-meter.js';

const ALL = { hour: '', day: '' };

function setup() {
  const db = AevraDatabase.open(':memory:');
  const repo = new TokenUsageRepository(db.raw());
  let current = new Date('2026-10-07T10:15:00.000Z');
  const logs: string[] = [];
  const meter = new UsageMeter(repo, { now: () => current, log: (m) => logs.push(m) });
  return {
    db,
    repo,
    meter,
    logs,
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
  };
}

test('a tool call is counted, estimated and flushed into its hour bucket', () => {
  const { db, repo, meter, advance } = setup();
  const token = meter.begin('connector:alpha', 'tools/call', 'file_list', { path: '/' });
  advance(40);
  meter.finish(token, JSON.stringify({ entries: [] }), { savedTokens: 20 });
  meter.flush();
  const [row] = repo.rows(ALL);
  assert.equal(row!.bucket, '2026-10-07T10');
  assert.equal(row!.tool, 'file_list');
  assert.equal(row!.calls, 1);
  assert.equal(row!.errors, 0);
  assert.equal(row!.inputTokens, estimateTokens('{"path":"/"}'));
  assert.equal(row!.outputTokens, estimateTokens('{"entries":[]}'));
  assert.equal(row!.savedTokens, 20);
  assert.equal(row!.durationMs, 40);
  db.close();
});

test('non-tool methods are recorded under the method name', () => {
  const { db, repo, meter } = setup();
  meter.finish(meter.begin('oauth:Beta', 'tools/list', undefined, {}), '{}');
  meter.flush();
  assert.equal(repo.rows(ALL)[0]!.tool, 'tools/list');
  db.close();
});

test('failures count as errors; fail() records no output', () => {
  const { db, repo, meter } = setup();
  meter.finish(meter.begin('a', 'tools/call', 'x', {}), '{"error":1}', { failed: true });
  meter.fail(meter.begin('a', 'tools/call', 'x', {}));
  meter.flush();
  const [row] = repo.rows(ALL);
  assert.equal(row!.calls, 2);
  assert.equal(row!.errors, 2);
  db.close();
});

test('a token is recorded once even if finish and fail both run', () => {
  const { db, repo, meter } = setup();
  const token = meter.begin('a', 'tools/call', 'x', {});
  meter.finish(token, 'ok');
  meter.fail(token);
  meter.flush();
  assert.equal(repo.rows(ALL)[0]!.calls, 1);
  db.close();
});

test('a failed flush keeps the counters and the next flush stores them', () => {
  const { db, repo, logs } = setup();
  let broken = true;
  const store = {
    add: (rows: Parameters<TokenUsageRepository['add']>[0]) => {
      if (broken) throw new Error('disk busy');
      repo.add(rows);
    },
    rollup: () => 0,
    rows: (b: Parameters<TokenUsageRepository['rows']>[0]) => repo.rows(b),
  };
  const meter = new UsageMeter(store, {
    now: () => new Date('2026-10-07T10:15:00.000Z'),
    log: (m) => logs.push(m),
  });
  meter.finish(meter.begin('a', 'tools/call', 'x', {}), 'ok');
  meter.flush();
  assert.deepEqual(repo.rows(ALL), []);
  assert.ok(logs.some((m) => m.includes('disk busy')));
  broken = false;
  meter.flush();
  assert.equal(repo.rows(ALL)[0]!.calls, 1);
  db.close();
});

test('report merges unflushed counters without double counting after a flush', () => {
  const { db, meter } = setup();
  meter.finish(meter.begin('a', 'tools/call', 'x', {}), 'ok');
  assert.equal(meter.report('24h').totals.calls, 1);
  meter.flush();
  assert.equal(meter.report('24h').totals.calls, 1);
  db.close();
});

test('close flushes what is pending and stops the timers', async () => {
  const { db, repo, meter } = setup();
  meter.start();
  meter.finish(meter.begin('a', 'tools/call', 'x', {}), 'ok');
  await meter.close();
  assert.equal(repo.rows(ALL)[0]!.calls, 1);
  db.close();
});

test('accounting never throws on input that cannot be serialized', () => {
  const { db, meter } = setup();
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const token = meter.begin('a', 'tools/call', 'x', circular);
  assert.equal(token.inputTokens, 0);
  db.close();
});

test('responseFailed detects JSON-RPC errors and tool errors', () => {
  assert.equal(responseFailed({ error: { code: -1 } }), true);
  assert.equal(responseFailed({ result: { isError: true } }), true);
  assert.equal(responseFailed({ result: { content: [] } }), false);
  assert.equal(responseFailed(null), false);
});
