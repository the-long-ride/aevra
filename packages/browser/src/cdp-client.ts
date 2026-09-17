import type { BrowserLogEntry, BrowserLogKind } from '../../protocol/src/browser.js';

interface Pending {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

const MAX_BUFFERED = 500;

/**
 * Minimal Chrome DevTools Protocol client: request/response correlation by id,
 * plus bounded ring buffers for the console and network events the log tool
 * drains. It never evaluates page script.
 */
export class CdpClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly buffers: Record<BrowserLogKind, BrowserLogEntry[]> = {
    console: [],
    network: [],
  };

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => this.receive(String(event.data)));
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error('BROWSER_NOT_CONNECTED: CDP socket closed'));
      }
      this.pending.clear();
    });
  }

  static async connect(url: string, timeoutMs = 10_000): Promise<CdpClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('BROWSER_TIMEOUT: CDP connect timed out')),
        timeoutMs,
      );
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('BROWSER_UNAVAILABLE: CDP socket failed to open'));
      });
    });
    return new CdpClient(socket);
  }

  private push(kind: BrowserLogKind, entry: BrowserLogEntry): void {
    const buffer = this.buffers[kind];
    buffer.push(entry);
    if (buffer.length > MAX_BUFFERED) buffer.splice(0, buffer.length - MAX_BUFFERED);
  }

  private receive(raw: string): void {
    let message: any;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(String(message.error.message ?? 'CDP error')));
      else pending.resolve(message.result ?? {});
      return;
    }
    const at = new Date().toISOString();
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = (message.params?.args ?? [])
        .map((arg: any) => String(arg?.value ?? arg?.description ?? ''))
        .join(' ');
      this.push('console', {
        at,
        kind: 'console',
        level: String(message.params?.type ?? 'log'),
        text,
      });
      return;
    }
    if (message.method === 'Log.entryAdded') {
      this.push('console', {
        at,
        kind: 'console',
        level: String(message.params?.entry?.level ?? 'info'),
        text: String(message.params?.entry?.text ?? ''),
      });
      return;
    }
    if (message.method === 'Network.responseReceived') {
      this.push('network', {
        at,
        kind: 'network',
        text: String(message.params?.response?.url ?? ''),
        url: String(message.params?.response?.url ?? ''),
        status: Number(message.params?.response?.status ?? 0),
      });
    }
  }

  send<T = any>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 15_000,
  ): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`BROWSER_TIMEOUT: ${method} exceeded ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  drain(kind: BrowserLogKind, limit: number): BrowserLogEntry[] {
    return this.buffers[kind].slice(-Math.max(1, limit));
  }

  async close(): Promise<void> {
    this.socket.close();
  }
}
