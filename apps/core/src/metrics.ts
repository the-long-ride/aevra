export class MetricsService {
  private counts = new Map<string, number>();
  private totalMs = new Map<string, number>();
  record(tool: string, durationMs: number) {
    this.counts.set(tool, (this.counts.get(tool) ?? 0) + 1);
    this.totalMs.set(tool, (this.totalMs.get(tool) ?? 0) + Math.max(0, Math.round(durationMs)));
  }
  snapshot() {
    return [...this.counts.entries()]
      .sort()
      .map(([tool, calls]) => ({
        tool,
        calls,
        totalMs: this.totalMs.get(tool) ?? 0,
        avgMs: calls ? Math.round((this.totalMs.get(tool) ?? 0) / calls) : 0,
      }));
  }
  reset() {
    this.counts.clear();
    this.totalMs.clear();
  }
}
