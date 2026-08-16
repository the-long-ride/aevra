export class IpRateLimiter {
  constructor(
    private capacity: number,
    private refillPerSecond: number,
    private now: () => number = Date.now,
  ) {}
  private buckets = new Map<string, { tokens: number; last: number }>();
  private failed = new Map<string, number>();
  allow(ip: string): boolean {
    const b = this.bucket(ip);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
  recordFailure(ip: string) {
    this.failed.set(ip, (this.failed.get(ip) ?? 0) + 1);
  }
  totalFailures(): number {
    let t = 0;
    for (const v of this.failed.values()) t += v;
    return t;
  }
  failures(): Array<{ ip: string; count: number }> {
    return [...this.failed.entries()].map(([ip, count]) => ({ ip, count }));
  }
  private bucket(ip: string) {
    const now = this.now();
    let b = this.buckets.get(ip);
    if (!b) {
      b = { tokens: this.capacity, last: now };
      this.buckets.set(ip, b);
    } else {
      b.tokens = Math.min(this.capacity, b.tokens + ((now - b.last) / 1000) * this.refillPerSecond);
      b.last = now;
    }
    return b;
  }
}
