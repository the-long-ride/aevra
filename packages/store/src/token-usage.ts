import type { DatabaseSync } from 'node:sqlite';

export type UsageGranularity = 'hour' | 'day';
export interface UsageDelta {
  connector: string;
  tool: string;
  calls: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  savedTokens: number;
  durationMs: number;
}
export interface UsageRow extends UsageDelta {
  granularity: UsageGranularity;
  bucket: string;
}
/** Inclusive lower bounds per granularity. `''` is unbounded, `NO_ROWS` selects nothing. */
export interface UsageBounds {
  hour: string;
  day: string;
}

/** Sorts after every real bucket key, so `bucket >= NO_ROWS` matches nothing. */
export const NO_ROWS = '￿';
const HOURLY_RETENTION_MS = 7 * 24 * 3_600_000;

export function hourBucket(date: Date): string {
  return date.toISOString().slice(0, 13);
}
export function hourBucketStart(bucket: string): Date {
  return new Date(`${bucket}:00:00.000Z`);
}
export function localDayBucket(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

const COLUMNS =
  'granularity,bucket,connector,tool,calls,errors,input_tokens,output_tokens,saved_tokens,duration_ms';
const UPSERT = `INSERT INTO token_usage(${COLUMNS}) VALUES(?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(granularity,bucket,connector,tool) DO UPDATE SET
  calls=calls+excluded.calls,
  errors=errors+excluded.errors,
  input_tokens=input_tokens+excluded.input_tokens,
  output_tokens=output_tokens+excluded.output_tokens,
  saved_tokens=saved_tokens+excluded.saved_tokens,
  duration_ms=duration_ms+excluded.duration_ms`;

function toRow(raw: Record<string, any>): UsageRow {
  return {
    granularity: raw.granularity as UsageGranularity,
    bucket: String(raw.bucket),
    connector: String(raw.connector),
    tool: String(raw.tool),
    calls: Number(raw.calls),
    errors: Number(raw.errors),
    inputTokens: Number(raw.input_tokens),
    outputTokens: Number(raw.output_tokens),
    savedTokens: Number(raw.saved_tokens),
    durationMs: Number(raw.duration_ms),
  };
}

export class TokenUsageRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** Adds the counters to their rows, creating rows as needed. One transaction. */
  add(rows: readonly UsageRow[]): void {
    if (!rows.length) return;
    this.transaction(() => {
      for (const row of rows) this.upsert(row);
    });
  }

  /**
   * Folds hour rows older than seven days into host-local day rows. Returns how
   * many hour rows were folded. Safe to call repeatedly.
   */
  rollup(now: Date): number {
    const cutoff = hourBucket(new Date(now.getTime() - HOURLY_RETENTION_MS));
    const old = (
      this.db
        .prepare(`SELECT ${COLUMNS} FROM token_usage WHERE granularity='hour' AND bucket < ?`)
        .all(cutoff) as Array<Record<string, any>>
    ).map(toRow);
    if (!old.length) return 0;
    this.transaction(() => {
      for (const row of old) {
        this.upsert({
          ...row,
          granularity: 'day',
          bucket: localDayBucket(hourBucketStart(row.bucket)),
        });
      }
      this.db
        .prepare("DELETE FROM token_usage WHERE granularity='hour' AND bucket < ?")
        .run(cutoff);
    });
    return old.length;
  }

  rows(bounds: UsageBounds): UsageRow[] {
    const found = this.db
      .prepare(
        `SELECT ${COLUMNS} FROM token_usage
         WHERE (granularity='hour' AND bucket >= ?) OR (granularity='day' AND bucket >= ?)
         ORDER BY bucket`,
      )
      .all(bounds.hour, bounds.day) as Array<Record<string, any>>;
    return found.map(toRow);
  }

  private upsert(row: UsageRow) {
    this.db
      .prepare(UPSERT)
      .run(
        row.granularity,
        row.bucket,
        row.connector,
        row.tool,
        row.calls,
        row.errors,
        row.inputTokens,
        row.outputTokens,
        row.savedTokens,
        row.durationMs,
      );
  }

  private transaction(work: () => void) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      work();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
