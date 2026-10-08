import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../src/database.js';
import {
  TokenUsageRepository,
  hourBucket,
  hourBucketStart,
  localDayBucket,
  type UsageRow,
} from '../src/token-usage.js';

const ALL = { hour: '', day: '' };

function row(bucket: string, over: Partial<UsageRow> = {}): UsageRow {
  return {
    granularity: 'hour',
    bucket,
    connector: 'connector:alpha',
    tool: 'file_list',
    calls: 1,
    errors: 0,
    inputTokens: 10,
    outputTokens: 20,
    savedTokens: 5,
    durationMs: 30,
    ...over,
  };
}

function open() {
  const db = AevraDatabase.open(':memory:');
  return { db, repo: new TokenUsageRepository(db.raw()) };
}

test('migration 25 creates the token_usage table', () => {
  const { db } = open();
  const table = db.raw().prepare("SELECT name FROM sqlite_master WHERE name='token_usage'").all();
  assert.equal(table.length, 1);
  const applied = db
    .raw()
    .prepare('SELECT name FROM schema_migrations WHERE version=25')
    .get() as any;
  assert.equal(applied.name, '025_token_usage');
  db.close();
});

test('bucket helpers format hour and local day keys', () => {
  assert.equal(hourBucket(new Date('2026-10-07T13:45:12.000Z')), '2026-10-07T13');
  assert.equal(hourBucketStart('2026-10-07T13').toISOString(), '2026-10-07T13:00:00.000Z');
  assert.equal(localDayBucket(new Date(2026, 9, 7, 23, 30)), '2026-10-07');
});

test('add upserts counters for the same key', () => {
  const { db, repo } = open();
  repo.add([row('2026-10-07T10')]);
  repo.add([
    row('2026-10-07T10', {
      calls: 2,
      errors: 1,
      inputTokens: 5,
      outputTokens: 5,
      savedTokens: 1,
      durationMs: 10,
    }),
  ]);
  assert.deepEqual(repo.rows(ALL), [
    row('2026-10-07T10', {
      calls: 3,
      errors: 1,
      inputTokens: 15,
      outputTokens: 25,
      savedTokens: 6,
      durationMs: 40,
    }),
  ]);
  db.close();
});

test('add is atomic: a bad row rolls the whole batch back', () => {
  const { db, repo } = open();
  const bad = { ...row('2026-10-07T11'), granularity: 'week' } as unknown as UsageRow;
  assert.throws(() => repo.add([row('2026-10-07T10'), bad]));
  assert.deepEqual(repo.rows(ALL), []);
  db.close();
});

test('rows honours the hour and day lower bounds', () => {
  const { db, repo } = open();
  repo.add([
    row('2026-10-07T09'),
    row('2026-10-07T10'),
    row('2026-09-01', { granularity: 'day' }),
    row('2026-09-30', { granularity: 'day' }),
  ]);
  const found = repo.rows({ hour: '2026-10-07T10', day: '2026-09-30' });
  assert.deepEqual(found.map((r) => `${r.granularity}:${r.bucket}`).sort(), [
    'day:2026-09-30',
    'hour:2026-10-07T10',
  ]);
  db.close();
});

test('rollup folds hour rows older than 7 days into local-day rows and keeps recent hours', () => {
  const { db, repo } = open();
  const now = new Date('2026-10-20T12:00:00.000Z');
  const old = ['2026-10-01T03', '2026-10-01T22'];
  repo.add([row(old[0]!), row(old[1]!, { tool: 'search' }), row('2026-10-19T10')]);
  assert.equal(repo.rollup(now), 2);
  const rows = repo.rows(ALL);
  assert.equal(rows.filter((r) => r.granularity === 'hour').length, 1);
  const days = rows.filter((r) => r.granularity === 'day');
  const expectedDays = new Set(old.map((b) => localDayBucket(hourBucketStart(b))));
  assert.deepEqual(new Set(days.map((r) => r.bucket)), expectedDays);
  assert.equal(
    days.reduce((sum, r) => sum + r.calls, 0),
    2,
  );
  assert.equal(repo.rollup(now), 0);
  db.close();
});
