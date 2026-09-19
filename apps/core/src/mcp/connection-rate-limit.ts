export interface ConnectionRateLimiterOptions {
  capacity?: number;
  refillPerSecond?: number;
  maxKeys?: number;
  idlePruneMs?: number;
  now?: () => number;
}

export class ConnectionRateLimiter {
  private capacity: number;
  private refillPerSecond: number;
  private maxKeys: number;
  private idlePruneMs: number;
  private now: () => number;
  private buckets = new Map<string, { tokens: number; last: number; lastTouched: number }>();

  constructor(options: ConnectionRateLimiterOptions = {}) {
    this.capacity = options.capacity ?? 120;
    this.refillPerSecond = options.refillPerSecond ?? 20;
    this.maxKeys = options.maxKeys ?? 10_000;
    this.idlePruneMs = options.idlePruneMs ?? 10 * 60_000;
    this.now = options.now ?? Date.now;
  }

  allow(connectionId: string): boolean {
    const now = this.now();
    this.prune(now);

    let b = this.buckets.get(connectionId);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) {
        let evictKey: string | undefined;
        for (const [key, bucket] of this.buckets.entries()) {
          const effectiveTokens = Math.min(
            this.capacity,
            bucket.tokens + ((now - bucket.last) / 1000) * this.refillPerSecond,
          );
          if (effectiveTokens >= 1) {
            evictKey = key;
            break;
          }
        }
        if (evictKey !== undefined) {
          this.buckets.delete(evictKey);
        } else {
          return false;
        }
      }
      b = { tokens: this.capacity, last: now, lastTouched: now };
    } else {
      b.tokens = Math.min(this.capacity, b.tokens + ((now - b.last) / 1000) * this.refillPerSecond);
      b.last = now;
      b.lastTouched = now;
    }

    this.buckets.delete(connectionId);
    this.buckets.set(connectionId, b);

    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  retryAfterSeconds(connectionId: string): number {
    const b = this.buckets.get(connectionId);
    if (!b || b.tokens >= 1) return 0;
    const needed = 1 - b.tokens;
    return Math.max(1, Math.ceil(needed / this.refillPerSecond));
  }

  clear(connectionId: string): void {
    this.buckets.delete(connectionId);
  }

  size(): number {
    return this.buckets.size;
  }

  private prune(now: number): void {
    const cutoff = now - this.idlePruneMs;
    for (const [key, b] of this.buckets.entries()) {
      if (b.lastTouched < cutoff) {
        this.buckets.delete(key);
      }
    }
  }
}
