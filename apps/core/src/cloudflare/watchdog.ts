export interface TunnelHealth {
  reachable: boolean | null;
  checkedAt: string | null;
  message: string | null;
}

export class TunnelWatchdog {
  status: TunnelHealth = { reachable: null, checkedAt: null, message: null };
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<TunnelHealth>;
  private stopped = true;
  private wasReachable = false;

  constructor(
    private probe: () => Promise<{ reachable: boolean; message: string }>,
    private intervalMs: number = 60_000,
    private onDrop?: (message: string) => void,
  ) {}

  start() {
    this.stopped = false;
    void this.runLoop();
    return this;
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  checkNow(): Promise<TunnelHealth> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.tick().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async runLoop() {
    await this.checkNow();
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.runLoop(), this.intervalMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<TunnelHealth> {
    try {
      const result = await this.probe();
      this.status = {
        reachable: result.reachable,
        checkedAt: new Date().toISOString(),
        message: result.message,
      };
      if (this.wasReachable && !result.reachable && this.onDrop) {
        this.onDrop(result.message || 'tunnel unreachable');
      }
      this.wasReachable = result.reachable;
    } catch (error) {
      this.status = {
        reachable: false,
        checkedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error),
      };
      this.wasReachable = false;
    }
    return this.status;
  }
}
