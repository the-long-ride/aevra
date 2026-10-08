import type {
  TokenUsageRange,
  TokenUsageReport,
  TokenUsageTotals,
} from '../../../../packages/admin-contracts/src/token-usage.js';
import { TOKEN_ESTIMATOR } from '../../../../packages/protocol/src/token-estimate.js';
import {
  NO_ROWS,
  hourBucket,
  hourBucketStart,
  localDayBucket,
  type UsageBounds,
  type UsageDelta,
  type UsageRow,
} from '../../../../packages/store/src/token-usage.js';

const HOUR_MS = 3_600_000;
const SPANS = { '24h': 24, '7d': 168, '30d': 30, '90d': 90 } as const;
const MAX_ALL_BUCKETS = 3_660;
const TOP_TOOLS = 10;

interface Acc {
  calls: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  savedTokens: number;
  durationMs: number;
}
const zero = (): Acc => ({
  calls: 0,
  errors: 0,
  inputTokens: 0,
  outputTokens: 0,
  savedTokens: 0,
  durationMs: 0,
});
function addTo(acc: Acc, row: UsageDelta) {
  acc.calls += row.calls;
  acc.errors += row.errors;
  acc.inputTokens += row.inputTokens;
  acc.outputTokens += row.outputTokens;
  acc.savedTokens += row.savedTokens;
  acc.durationMs += row.durationMs;
}
function finish(acc: Acc): TokenUsageTotals {
  return {
    calls: acc.calls,
    errors: acc.errors,
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    savedTokens: acc.savedTokens,
    avgDurationMs: acc.calls ? Math.round(acc.durationMs / acc.calls) : 0,
  };
}
function accFor(map: Map<string, Acc>, key: string): Acc {
  let acc = map.get(key);
  if (!acc) map.set(key, (acc = zero()));
  return acc;
}
function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
function parseDay(bucket: string): Date {
  const [year, month, day] = bucket.split('-').map(Number);
  return new Date(year!, month! - 1, day!);
}
function dayKey(row: UsageRow): string {
  return row.granularity === 'day' ? row.bucket : localDayBucket(hourBucketStart(row.bucket));
}
function granularityOf(range: TokenUsageRange): 'hour' | 'day' {
  return range === '24h' || range === '7d' ? 'hour' : 'day';
}

/** Lower bounds for the rows a range needs, to pass to `TokenUsageRepository.rows`. */
export function rangeBounds(range: TokenUsageRange, now: Date): UsageBounds {
  if (range === 'all') return { hour: '', day: '' };
  const span = SPANS[range];
  if (granularityOf(range) === 'hour') {
    return { hour: hourBucket(new Date(now.getTime() - (span - 1) * HOUR_MS)), day: NO_ROWS };
  }
  return { hour: '', day: localDayBucket(addDays(now, -(span - 1))) };
}

function seriesKeys(
  range: TokenUsageRange,
  rows: readonly UsageRow[],
  now: Date,
  granularity: 'hour' | 'day',
): string[] {
  if (granularity === 'hour') {
    const span = SPANS[range as '24h' | '7d'];
    return Array.from({ length: span }, (_, i) =>
      hourBucket(new Date(now.getTime() - (span - 1 - i) * HOUR_MS)),
    );
  }
  const today = localDayBucket(now);
  if (range === 'all') {
    const first = rows.map(dayKey).sort()[0] ?? today;
    const keys: string[] = [];
    for (let day = parseDay(first); keys.length < MAX_ALL_BUCKETS; day = addDays(day, 1)) {
      const key = localDayBucket(day);
      keys.push(key);
      if (key >= today) break;
    }
    return keys;
  }
  const span = SPANS[range];
  return Array.from({ length: span }, (_, i) => localDayBucket(addDays(now, -(span - 1 - i))));
}

function ranked(map: Map<string, Acc>) {
  return [...map.entries()]
    .sort(
      ([nameA, a], [nameB, b]) =>
        b.outputTokens - a.outputTokens || b.calls - a.calls || nameA.localeCompare(nameB),
    )
    .map(([name, acc]) => ({ name, ...finish(acc) }));
}

export function buildTokenUsageReport(
  rows: readonly UsageRow[],
  range: TokenUsageRange,
  now: Date,
): TokenUsageReport {
  const granularity = granularityOf(range);
  const keys = seriesKeys(range, rows, now, granularity);
  const buckets = new Map(keys.map((key) => [key, zero()] as const));
  const total = zero();
  const today = zero();
  const todayKey = localDayBucket(now);
  const todayTools = new Map<string, number>();
  const tools = new Map<string, Acc>();
  const connectors = new Map<string, Acc>();

  for (const row of rows) {
    const day = dayKey(row);
    if (day === todayKey) {
      addTo(today, row);
      todayTools.set(row.tool, (todayTools.get(row.tool) ?? 0) + row.outputTokens);
    }
    const key =
      granularity === 'hour' ? (row.granularity === 'hour' ? row.bucket : undefined) : day;
    const slot = key === undefined ? undefined : buckets.get(key);
    if (!slot) continue;
    addTo(slot, row);
    addTo(total, row);
    addTo(accFor(tools, row.tool), row);
    addTo(accFor(connectors, row.connector), row);
  }

  const top = [...todayTools.entries()].sort(([a, x], [b, y]) => y - x || a.localeCompare(b))[0];
  return {
    estimator: TOKEN_ESTIMATOR,
    range,
    granularity,
    totals: finish(total),
    today: finish(today),
    topToolToday: top ? { tool: top[0], outputTokens: top[1] } : null,
    series: keys.map((key) => ({
      start: (granularity === 'hour' ? hourBucketStart(key) : parseDay(key)).toISOString(),
      ...finish(buckets.get(key)!),
    })),
    byTool: ranked(tools)
      .slice(0, TOP_TOOLS)
      .map(({ name, ...totals }) => ({ tool: name, ...totals })),
    byConnector: ranked(connectors).map(({ name, ...totals }) => ({
      connector: name,
      label: name.replace(/^(connector|oauth|client):/, ''),
      ...totals,
    })),
  };
}
