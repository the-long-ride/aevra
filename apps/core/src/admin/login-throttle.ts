const MAX_USERNAME_CHARS = 128;
const SATURATED_RETRY_MS = 1000;

export interface LoginLockoutEvent {
  scope: 'ip' | 'ip-username';
  ip: string;
  lockSeconds: number;
  level: number;
}

export type LoginAttempt =
  | { allowed: false; retryAfterSeconds: number }
  | { allowed: true; failure(): LoginLockoutEvent[]; success(): void; abandon(): void };

interface LoginThrottleOptions {
  /** Failures in the window that lock one (ip, username) pair. */
  pairThreshold?: number;
  /** Failures in the window that lock an ip across every username. */
  ipThreshold?: number;
  windowMs?: number;
  baseLockMs?: number;
  maxLockMs?: number;
  maxKeys?: number;
  now?: () => number;
}

interface Tracker {
  failures: number[];
  pending: number;
  level: number;
  lockedUntil: number;
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase().slice(0, MAX_USERNAME_CHARS);
}

/**
 * Throttles failed Admin logins by client address and by (address, username).
 *
 * A tracker locks once it sees `threshold` failures inside a sliding window. Each
 * further lockout doubles the lock, capped at `maxLockMs`, and the level decays after
 * a quiet window. Locks are temporary on purpose: a permanent per-username lock would
 * let anyone who knows the username lock the owner out. Attempts still being verified
 * count as failures, so a burst of parallel guesses cannot all pass the check before
 * the first failure is recorded. State is in memory and resets on restart.
 */
export class LoginThrottle {
  private readonly pairs = new Map<string, Tracker>();
  private readonly ips = new Map<string, Tracker>();
  private readonly pairThreshold: number;
  private readonly ipThreshold: number;
  private readonly windowMs: number;
  private readonly baseLockMs: number;
  private readonly maxLockMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(options: LoginThrottleOptions = {}) {
    this.pairThreshold = options.pairThreshold ?? 5;
    this.ipThreshold = options.ipThreshold ?? 20;
    this.windowMs = options.windowMs ?? 15 * 60_000;
    this.baseLockMs = options.baseLockMs ?? 60_000;
    this.maxLockMs = options.maxLockMs ?? 60 * 60_000;
    this.maxKeys = options.maxKeys ?? 4096;
    this.now = options.now ?? Date.now;
  }

  begin(ip: string, username: string): LoginAttempt {
    const now = this.now();
    const pairKey = `${ip}\n${normalizeUsername(username)}`;
    const pair = this.touch(this.pairs, pairKey, now);
    const byIp = this.touch(this.ips, ip, now);
    const waitMs = Math.max(
      this.blockedForMs(pair, this.pairThreshold, now),
      this.blockedForMs(byIp, this.ipThreshold, now),
    );
    if (waitMs > 0) return { allowed: false, retryAfterSeconds: Math.ceil(waitMs / 1000) };

    pair.pending += 1;
    byIp.pending += 1;
    let settled = false;
    const settle = () => {
      if (settled) return false;
      settled = true;
      pair.pending -= 1;
      byIp.pending -= 1;
      return true;
    };
    return {
      allowed: true,
      failure: () => {
        if (!settle()) return [];
        const at = this.now();
        return [
          this.recordFailure(pair, this.pairThreshold, 'ip-username', ip, at),
          this.recordFailure(byIp, this.ipThreshold, 'ip', ip, at),
        ].filter((event): event is LoginLockoutEvent => event !== undefined);
      },
      success: () => {
        if (settle()) this.pairs.delete(pairKey);
      },
      abandon: () => void settle(),
    };
  }

  private blockedForMs(tracker: Tracker, threshold: number, now: number): number {
    if (tracker.lockedUntil > now) return tracker.lockedUntil - now;
    return tracker.failures.length + tracker.pending >= threshold ? SATURATED_RETRY_MS : 0;
  }

  private recordFailure(
    tracker: Tracker,
    threshold: number,
    scope: LoginLockoutEvent['scope'],
    ip: string,
    now: number,
  ): LoginLockoutEvent | undefined {
    tracker.failures.push(now);
    if (tracker.failures.length < threshold) return undefined;
    tracker.level += 1;
    const lockMs = Math.min(this.maxLockMs, this.baseLockMs * 2 ** (tracker.level - 1));
    tracker.lockedUntil = now + lockMs;
    tracker.failures = [];
    return { scope, ip, lockSeconds: Math.ceil(lockMs / 1000), level: tracker.level };
  }

  private touch(map: Map<string, Tracker>, key: string, now: number): Tracker {
    const tracker = map.get(key) ?? { failures: [], pending: 0, level: 0, lockedUntil: 0 };
    tracker.failures = tracker.failures.filter((at) => now - at < this.windowMs);
    if (this.isIdle(tracker, now) && now >= tracker.lockedUntil + this.windowMs) tracker.level = 0;
    map.delete(key);
    map.set(key, tracker);
    this.evict(map, now);
    return tracker;
  }

  private isIdle(tracker: Tracker, now: number): boolean {
    return tracker.lockedUntil <= now && tracker.pending === 0 && tracker.failures.length === 0;
  }

  /**
   * Keeps each map bounded so an attacker cycling addresses or usernames cannot grow
   * it without limit. Map order is least-recently-touched first; a tracker that is
   * still locked or has attempts in flight is only dropped when nothing else can be.
   */
  private evict(map: Map<string, Tracker>, now: number) {
    while (map.size > this.maxKeys) {
      let fallback: string | undefined;
      let victim: string | undefined;
      for (const [key, tracker] of map) {
        fallback ??= key;
        if (tracker.lockedUntil <= now && tracker.pending === 0) {
          victim = key;
          break;
        }
      }
      map.delete((victim ?? fallback)!);
    }
  }
}
