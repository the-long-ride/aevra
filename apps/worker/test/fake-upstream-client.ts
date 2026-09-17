import type {
  UpstreamCatalog,
  UpstreamServerInfo,
} from '../../../packages/mcp-upstream/src/protocol.js';
import type { UpstreamClientLike } from '../src/mcp-upstream-runtime.js';

export interface FakeUpstreamOptions {
  failConnect?: () => Error | null;
  closeDuringConnect?: boolean;
  catalog?: UpstreamCatalog;
  onCall?: (method: string, payload: unknown) => unknown;
}

export class FakeUpstreamClient implements UpstreamClientLike {
  connects = 0;
  closes = 0;
  private server: UpstreamServerInfo | null = null;
  private handler: (method: string, params: unknown) => void = () => {};
  private closedHandler: () => void = () => {};

  constructor(private readonly options: FakeUpstreamOptions = {}) {}

  async connect(): Promise<UpstreamServerInfo> {
    this.connects += 1;
    const failure = this.options.failConnect?.();
    if (failure) throw failure;
    this.server = {
      name: 'fake-upstream',
      version: '1.2.3',
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
    };
    if (this.options.closeDuringConnect) this.emitClosed();
    return this.server;
  }

  info(): UpstreamServerInfo | null {
    return this.server;
  }
  async catalog(): Promise<UpstreamCatalog> {
    return this.options.catalog ?? { tools: [], resources: [], prompts: [] };
  }
  async callTool(name: string, args: unknown): Promise<unknown> {
    return this.options.onCall?.('tools/call', { name, args }) ?? { ok: true };
  }
  async readResource(uri: string): Promise<unknown> {
    return this.options.onCall?.('resources/read', { uri }) ?? { ok: true };
  }
  async getPrompt(name: string, args?: unknown): Promise<unknown> {
    return this.options.onCall?.('prompts/get', { name, args }) ?? { ok: true };
  }
  async close(): Promise<void> {
    this.closes += 1;
    this.server = null;
  }
  onNotification(handler: (method: string, params: unknown) => void): void {
    this.handler = handler;
  }
  onClosed(handler: () => void): void {
    this.closedHandler = handler;
  }
  emit(method: string, params?: unknown): void {
    this.handler(method, params);
  }
  emitClosed(): void {
    this.server = null;
    this.closedHandler();
  }
}
