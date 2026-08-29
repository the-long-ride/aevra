export class IpRateLimiter {
  constructor(
    private capacity: number,
    private refillPerSecond: number,
    private now: () => number = Date.now,
    private maxKeys = 4096,
  ) {}
  private buckets = new Map<string, { tokens: number; last: number }>();
  private failed = new Map<string, number>();

  size(): number {
    return this.buckets.size;
  }

  allow(ip: string): boolean {
    const b = this.bucket(ip);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  recordFailure(ip: string) {
    const next = (this.failed.get(ip) ?? 0) + 1;
    this.failed.delete(ip);
    this.failed.set(ip, next);
    this.evict(this.failed);
  }

  totalFailures(): number {
    let t = 0;
    for (const v of this.failed.values()) t += v;
    return t;
  }

  failures(): Array<{ ip: string; count: number }> {
    return [...this.failed.entries()].map(([ip, count]) => ({ ip, count }));
  }

  /**
   * Drops least-recently-touched entries once a map exceeds maxKeys. Map iteration
   * follows insertion order and `bucket`/`recordFailure` re-insert on every touch,
   * so the first key is always the least recently used. Without this an attacker
   * cycling the rate-limit key could grow these maps without bound.
   */
  private evict(map: Map<string, unknown>) {
    while (map.size > this.maxKeys) {
      const oldest = map.keys().next();
      if (oldest.done) return;
      map.delete(oldest.value);
    }
  }

  private bucket(ip: string) {
    const now = this.now();
    let b = this.buckets.get(ip);
    if (!b) {
      b = { tokens: this.capacity, last: now };
    } else {
      b.tokens = Math.min(this.capacity, b.tokens + ((now - b.last) / 1000) * this.refillPerSecond);
      b.last = now;
      this.buckets.delete(ip);
    }
    this.buckets.set(ip, b);
    this.evict(this.buckets);
    return b;
  }
}
