export interface TunnelHealth {
  reachable: boolean | null;
  checkedAt: string | null;
  message: string | null;
}
export class TunnelWatchdog {
  status: TunnelHealth = { reachable: null, checkedAt: null, message: null };
  private timer?: NodeJS.Timeout;
  private wasReachable = false;
  constructor(
    private probe: () => Promise<{ reachable: boolean; message: string }>,
    private intervalMs: number = 60_000,
    private onDrop?: (message: string) => void,
  ) {}
  start() {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
    return this;
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
  private async tick() {
    try {
      const r = await this.probe();
      this.status = {
        reachable: r.reachable,
        checkedAt: new Date().toISOString(),
        message: r.message,
      };
      if (this.wasReachable && !r.reachable && this.onDrop)
        this.onDrop(r.message || 'tunnel unreachable');
      this.wasReachable = r.reachable;
    } catch (e) {
      this.status = {
        reachable: false,
        checkedAt: new Date().toISOString(),
        message: e instanceof Error ? e.message : String(e),
      };
      this.wasReachable = false;
    }
  }
}
