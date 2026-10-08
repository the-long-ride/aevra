import type {
  TokenUsageRange,
  TokenUsageReport,
} from '../../../../packages/admin-contracts/src/token-usage.js';
import { estimateTokens } from '../../../../packages/protocol/src/token-estimate.js';
import {
  hourBucket,
  type TokenUsageRepository,
  type UsageRow,
} from '../../../../packages/store/src/token-usage.js';
import { buildTokenUsageReport, rangeBounds } from './usage-report.js';

export interface UsageToken {
  startedAt: number;
  connector: string;
  tool: string;
  inputTokens: number;
  done: boolean;
}
type UsageStore = Pick<TokenUsageRepository, 'add' | 'rollup' | 'rows'>;
interface UsageMeterOptions {
  now?: () => Date;
  flushMs?: number;
  rollupMs?: number;
  log?: (message: string) => void;
}

const SEPARATOR = '\u0000';

export function responseFailed(response: unknown): boolean {
  const value = response as { error?: unknown; result?: { isError?: unknown } } | null;
  return Boolean(value?.error || value?.result?.isError);
}

function estimateInput(input: unknown): number {
  try {
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    return text ? estimateTokens(text) : 0;
  } catch {
    return 0;
  }
}

function addRow(map: Map<string, UsageRow>, row: UsageRow) {
  const key = `${row.bucket}${SEPARATOR}${row.connector}${SEPARATOR}${row.tool}`;
  const current = map.get(key);
  if (!current) {
    map.set(key, { ...row });
    return;
  }
  current.calls += row.calls;
  current.errors += row.errors;
  current.inputTokens += row.inputTokens;
  current.outputTokens += row.outputTokens;
  current.savedTokens += row.savedTokens;
  current.durationMs += row.durationMs;
}

/**
 * Counts the text that passes through the MCP edge. Accounting must never fail
 * a request, so every public method swallows its own errors and logs them.
 */
export class UsageMeter {
  private pending = new Map<string, UsageRow>();
  private flushTimer: NodeJS.Timeout | undefined;
  private rollupTimer: NodeJS.Timeout | undefined;
  private readonly now: () => Date;
  private readonly log: (message: string) => void;

  constructor(
    private readonly store: UsageStore,
    private readonly options: UsageMeterOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? ((message) => console.warn(`[aevra] ${message}`));
  }

  begin(actor: string, method: unknown, toolName: unknown, input: unknown): UsageToken {
    const methodName = typeof method === 'string' && method ? method : 'unknown';
    const tool =
      methodName === 'tools/call'
        ? typeof toolName === 'string' && toolName
          ? toolName
          : 'unknown-tool'
        : methodName;
    return {
      startedAt: this.now().getTime(),
      connector: actor,
      tool,
      inputTokens: estimateInput(input),
      done: false,
    };
  }

  finish(
    token: UsageToken,
    body: string | undefined,
    extra: { savedTokens?: number; failed?: boolean } = {},
  ): void {
    this.guard(() => this.record(token, body ? estimateTokens(body) : 0, extra));
  }

  fail(token: UsageToken): void {
    this.guard(() => this.record(token, 0, { failed: true }));
  }

  /** Writes pending counters to the database. On failure they are kept for the next flush. */
  flush(): void {
    if (!this.pending.size) return;
    const batch = this.pending;
    this.pending = new Map();
    try {
      this.store.add([...batch.values()]);
    } catch (error) {
      for (const row of batch.values()) addRow(this.pending, row);
      this.log(
        `token usage flush failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  report(range: TokenUsageRange): TokenUsageReport {
    const now = this.now();
    return buildTokenUsageReport(
      [...this.store.rows(rangeBounds(range, now)), ...this.pending.values()],
      range,
      now,
    );
  }

  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flush(), this.options.flushMs ?? 30_000);
    this.rollupTimer = setInterval(() => this.rollup(), this.options.rollupMs ?? 3_600_000);
    this.flushTimer.unref();
    this.rollupTimer.unref();
    this.rollup();
  }

  async close(): Promise<void> {
    clearInterval(this.flushTimer);
    clearInterval(this.rollupTimer);
    this.flushTimer = this.rollupTimer = undefined;
    this.flush();
  }

  private rollup() {
    this.guard(() => {
      this.store.rollup(this.now());
    });
  }

  private record(
    token: UsageToken,
    outputTokens: number,
    extra: { savedTokens?: number; failed?: boolean },
  ) {
    if (token.done) return;
    token.done = true;
    const at = this.now();
    addRow(this.pending, {
      granularity: 'hour',
      bucket: hourBucket(at),
      connector: token.connector,
      tool: token.tool,
      calls: 1,
      errors: extra.failed ? 1 : 0,
      inputTokens: token.inputTokens,
      outputTokens,
      savedTokens: extra.savedTokens ?? 0,
      durationMs: Math.max(0, at.getTime() - token.startedAt),
    });
  }

  private guard(work: () => void) {
    try {
      work();
    } catch (error) {
      this.log(
        `token usage accounting failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
