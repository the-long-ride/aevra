/**
 * Runs one reconcile at a time for list requests and bounds how long a caller waits.
 * A hung run keeps its slot, so later callers share it instead of starting another.
 */
export class ListReconciler {
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly run: () => Promise<void>,
    private readonly timeoutMs = 2000,
  ) {}

  settle(): Promise<void> {
    const work = this.start();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, this.timeoutMs);
      timer.unref();
      void work.then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private start(): Promise<void> {
    if (this.inflight) return this.inflight;
    const current: Promise<void> = Promise.resolve()
      .then(() => this.run())
      .catch(() => {})
      .then(() => {
        if (this.inflight === current) this.inflight = null;
      });
    this.inflight = current;
    return current;
  }
}
