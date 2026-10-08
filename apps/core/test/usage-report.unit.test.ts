import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NO_ROWS,
  hourBucket,
  hourBucketStart,
  localDayBucket,
  type UsageRow,
} from '../../../packages/store/src/token-usage.js';
import { buildTokenUsageReport, rangeBounds } from '../src/usage/usage-report.js';

const NOW = new Date(2026, 9, 7, 12, 30); // host-local, so the test is timezone independent

function hourRow(at: Date, over: Partial<UsageRow> = {}): UsageRow {
  return {
    granularity: 'hour',
    bucket: hourBucket(at),
    connector: 'connector:alpha',
    tool: 'file_list',
    calls: 2,
    errors: 1,
    inputTokens: 100,
    outputTokens: 300,
    savedTokens: 50,
    durationMs: 40,
    ...over,
  };
}

test('rangeBounds selects hours for 24h and 7d, days for 30d and 90d, everything for all', () => {
  assert.deepEqual(rangeBounds('all', NOW), { hour: '', day: '' });
  assert.equal(rangeBounds('24h', NOW).day, NO_ROWS);
  assert.equal(rangeBounds('7d', NOW).day, NO_ROWS);
  assert.equal(rangeBounds('24h', NOW).hour, hourBucket(new Date(NOW.getTime() - 23 * 3_600_000)));
  assert.equal(rangeBounds('30d', NOW).hour, '');
  assert.equal(rangeBounds('30d', NOW).day, localDayBucket(new Date(2026, 8, 8)));
});

test('an empty 24h report is a zero-filled hourly series', () => {
  const report = buildTokenUsageReport([], '24h', NOW);
  assert.equal(report.estimator, 'heuristic-v1');
  assert.equal(report.granularity, 'hour');
  assert.equal(report.series.length, 24);
  assert.ok(report.series.every((b) => b.calls === 0 && b.outputTokens === 0));
  assert.equal(report.series.at(-1)!.start, hourBucketStart(hourBucket(NOW)).toISOString());
  assert.equal(report.totals.calls, 0);
  assert.equal(report.topToolToday, null);
  assert.deepEqual(report.byTool, []);
});

test('rows fill their bucket, totals, today and the breakdowns', () => {
  const at = new Date(2026, 9, 7, 11, 0);
  const rows = [
    hourRow(at),
    hourRow(at, {
      connector: 'oauth:Beta',
      tool: 'search',
      calls: 1,
      errors: 0,
      outputTokens: 900,
      durationMs: 10,
    }),
  ];
  const report = buildTokenUsageReport(rows, '24h', NOW);
  const bucket = report.series.find(
    (b) => b.start === hourBucketStart(hourBucket(at)).toISOString(),
  )!;
  assert.equal(bucket.outputTokens, 1200);
  assert.equal(report.totals.calls, 3);
  assert.equal(report.totals.errors, 1);
  assert.equal(report.totals.avgDurationMs, 17);
  assert.equal(report.today.outputTokens, 1200);
  assert.deepEqual(report.topToolToday, { tool: 'search', outputTokens: 900 });
  assert.deepEqual(
    report.byTool.map((t) => t.tool),
    ['search', 'file_list'],
  );
  assert.deepEqual(
    report.byConnector.map((c) => [c.connector, c.label]),
    [
      ['oauth:Beta', 'Beta'],
      ['connector:alpha', 'alpha'],
    ],
  );
});

test('today excludes yesterday while a 7d total still counts it', () => {
  const rows = [
    hourRow(new Date(2026, 9, 7, 9, 0)),
    hourRow(new Date(2026, 9, 6, 9, 0), { outputTokens: 700 }),
  ];
  const report = buildTokenUsageReport(rows, '7d', NOW);
  assert.equal(report.series.length, 168);
  assert.equal(report.totals.outputTokens, 1000);
  assert.equal(report.today.outputTokens, 300);
});

test('30d folds hour rows into local days and includes stored day rows', () => {
  const rows: UsageRow[] = [
    hourRow(new Date(2026, 9, 7, 9, 0)),
    hourRow(new Date(2026, 9, 7, 10, 0)),
    { ...hourRow(new Date(2026, 8, 20, 9, 0)), granularity: 'day', bucket: '2026-09-20' },
  ];
  const report = buildTokenUsageReport(rows, '30d', NOW);
  assert.equal(report.granularity, 'day');
  assert.equal(report.series.length, 30);
  assert.equal(report.series.at(-1)!.outputTokens, 600);
  assert.equal(
    report.series.some((b) => b.outputTokens === 300 && b.calls === 2),
    true,
  );
  assert.equal(report.totals.outputTokens, 900);
});

test('all starts at the earliest stored day', () => {
  const rows: UsageRow[] = [{ ...hourRow(NOW), granularity: 'day', bucket: '2026-09-01' }];
  const report = buildTokenUsageReport(rows, 'all', NOW);
  assert.equal(report.series.length, 37); // 30 days of September + 7 of October
  assert.equal(report.totals.outputTokens, 300);
});

test('byTool keeps only the top ten by output tokens', () => {
  const at = new Date(2026, 9, 7, 11, 0);
  const rows = Array.from({ length: 12 }, (_, i) =>
    hourRow(at, { tool: `tool_${i}`, outputTokens: i * 10 }),
  );
  const report = buildTokenUsageReport(rows, '24h', NOW);
  assert.equal(report.byTool.length, 10);
  assert.equal(report.byTool[0]!.tool, 'tool_11');
});
