import { UpstreamError, type JsonRpcResponse, type UpstreamErrorCode } from './protocol.js';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class PendingCalls {
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private generationValue = 1;

  constructor(
    private readonly deadlineMs: number,
    private readonly onTimeout: () => void,
  ) {}

  generation(): number {
    return this.generationValue;
  }

  size(): number {
    return this.pending.size;
  }

  issue<T>(method: string): { id: number; promise: Promise<T> } {
    const id = this.nextId++;
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.onTimeout();
        reject(new UpstreamError('UPSTREAM_TIMEOUT', `${method} exceeded its deadline`));
      }, this.deadlineMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
    });
    return { id, promise };
  }

  settle(response: JsonRpcResponse): void {
    const entry = this.pending.get(response.id);
    if (!entry) return;
    this.pending.delete(response.id);
    clearTimeout(entry.timer);
    if (response.error) {
      entry.reject(
        new UpstreamError('UPSTREAM_CALL_FAILED', response.error.message, response.error.data),
      );
      return;
    }
    entry.resolve(response.result);
  }

  failAll(code: UpstreamErrorCode, message: string): void {
    this.generationValue += 1;
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) {
      clearTimeout(entry.timer);
      entry.reject(new UpstreamError(code, message));
    }
  }
}
