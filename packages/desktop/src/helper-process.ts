import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { DesktopDriverError } from './driver.js';

export interface HelperProcessOptions {
  command: string;
  args: string[];
  deadlineMs: number;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export const ALLOWED_HELPER_ERROR_CODES = new Set([
  'DESKTOP_BACKGROUND_UNSUPPORTED',
  'DESKTOP_CAPTURE_UNSUPPORTED',
  'DESKTOP_PERMISSION_REQUIRED',
  'DESKTOP_PROVIDER_UNAVAILABLE',
  'DESKTOP_PATTERN_UNSUPPORTED',
  'DESKTOP_ELEMENT_DISABLED',
  'DESKTOP_VALUE_READ_ONLY',
  'DESKTOP_REF_STALE',
  'DESKTOP_TARGET_CHANGED',
  'DESKTOP_WINDOW_BUSY',
  'DESKTOP_LEASE_EXPIRED',
  'DESKTOP_INPUT_REFUSED',
  'DESKTOP_OUTCOME_UNKNOWN',
  'DESKTOP_FOCUS_CHANGED',
  'DESKTOP_DRIVER_DIED',
  'DESKTOP_TIMEOUT',
  'DESKTOP_HELPER',
]);

const ALLOWED_DETAIL_KEYS = new Set([
  'windowId',
  'ref',
  'retryAfterMs',
  'expectedGeneration',
  'actualGeneration',
  'pattern',
  'action',
  'reason',
]);

export function parseHelperError(raw: unknown): {
  code: string;
  message: string;
  details?: Record<string, unknown>;
} {
  if (typeof raw === 'string') {
    return { code: 'DESKTOP_HELPER', message: raw };
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const rawCode = typeof obj.code === 'string' ? obj.code : 'DESKTOP_HELPER';
    const code = ALLOWED_HELPER_ERROR_CODES.has(rawCode) ? rawCode : 'DESKTOP_HELPER';
    const message = typeof obj.message === 'string' ? obj.message : 'Unknown helper error';
    let details: Record<string, unknown> | undefined;
    if (obj.details && typeof obj.details === 'object' && !Array.isArray(obj.details)) {
      const filtered: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj.details as Record<string, unknown>)) {
        if (
          ALLOWED_DETAIL_KEYS.has(k) &&
          (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
        ) {
          filtered[k] = v;
        }
      }
      if (Object.keys(filtered).length > 0) {
        details = filtered;
      }
    }
    return details ? { code, message, details } : { code, message };
  }
  return { code: 'DESKTOP_HELPER', message: 'Unknown helper error' };
}

/**
 * Supervises the native helper child process: frames calls as line-delimited
 * JSON-RPC, enforces a per-call deadline, and advances a generation counter
 * whenever the helper dies or is killed. Refs minted by a dead generation can
 * never resolve against a later one, which is what stops a stale ref from
 * silently acting on whatever now occupies those pixels.
 */
export class HelperProcess {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<number, Pending>();
  private buffer = '';
  private nextId = 1;
  private generationValue = 1;

  constructor(private readonly options: HelperProcessOptions) {}

  generation(): number {
    return this.generationValue;
  }

  private start(): ChildProcessWithoutNullStreams {
    const child = spawn(this.options.command, this.options.args, { stdio: 'pipe' });
    child.stdout.setEncoding('utf8');
    // A timed-out or killed predecessor's OS-level exit/error events can
    // arrive asynchronously, after a replacement child has already been
    // spawned. Every handler here is gated on the child instance it was
    // registered for, so a stale event from a child that is no longer
    // `this.child` cannot act on behalf of -- or tear down -- its live
    // replacement.
    child.stdout.on('data', (chunk: string) => {
      if (this.child !== child) return;
      this.absorb(chunk);
    });
    // A write to a stdin whose reader already exited surfaces as an async
    // 'error' event (e.g. EPIPE) rather than a thrown exception. Without a
    // handler here that would crash the process instead of failing the call.
    child.stdin.on('error', () => {
      /* surfaced instead via the child's own 'exit'/'error' handlers below */
    });
    child.on('exit', () => {
      if (this.child !== child) return;
      this.fail('DESKTOP_DRIVER_DIED', 'The desktop helper exited');
    });
    child.on('error', () => {
      if (this.child !== child) return;
      this.fail('DESKTOP_DRIVER_DIED', 'The desktop helper could not start');
    });
    this.child = child;
    return child;
  }

  private absorb(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf('\n');
    while (index !== -1) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      try {
        const message = JSON.parse(line) as { id: number; result?: unknown; error?: unknown };
        const entry = this.pending.get(message.id);
        if (entry) {
          this.pending.delete(message.id);
          clearTimeout(entry.timer);
          if (message.error !== undefined && message.error !== null) {
            const parsed = parseHelperError(message.error);
            entry.reject(new DesktopDriverError(parsed.code, parsed.message, parsed.details));
          } else {
            entry.resolve(message.result);
          }
        }
      } catch {
        // A helper that emits a line we cannot parse has told us nothing. The
        // call it belonged to is left to its deadline rather than guessed at.
      }
      index = this.buffer.indexOf('\n');
    }
  }

  /**
   * Every outstanding call fails and the generation advances, which invalidates
   * every ref minted by the dead process. Safe to call repeatedly (kill() and
   * the child's own exit/error handlers can both reach here): once pending is
   * empty this is a no-op beyond bumping the generation again, so callers that
   * already removed their own entry (the timeout path) never get double-settled.
   * The buffer is cleared too, so a dead child's unterminated partial line can
   * never concatenate with a subsequent child's first reply.
   */
  private fail(code: string, message: string): void {
    this.child = null;
    this.buffer = '';
    this.generationValue += 1;
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) {
      clearTimeout(entry.timer);
      entry.reject(new DesktopDriverError(code, message));
    }
  }

  call<T>(method: string, params: unknown): Promise<T> {
    const child = this.child ?? this.start();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // A hung accessibility call must not wedge the queue behind it. Killing
        // the helper is the only reliable way back. The entry above is already
        // removed, so fail()'s sweep of `pending` cannot reject this promise a
        // second time.
        this.kill();
        reject(new DesktopDriverError('DESKTOP_TIMEOUT', `${method} exceeded its deadline`));
      }, this.options.deadlineMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  kill(): void {
    this.child?.kill();
    this.fail('DESKTOP_DRIVER_DIED', 'The desktop helper was stopped');
  }
}
