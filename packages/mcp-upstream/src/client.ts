import {
  UpstreamError,
  type UpstreamCatalog,
  type UpstreamPrompt,
  type UpstreamResource,
  type UpstreamServerInfo,
  type UpstreamTool,
} from './protocol.js';
import type { UpstreamTransport } from './transport.js';

export class UpstreamClient {
  private serverInfo: UpstreamServerInfo | null = null;

  constructor(private readonly transport: UpstreamTransport) {}

  onNotification(handler: (method: string, params: unknown) => void): void {
    this.transport.onNotification(handler);
  }

  onClosed(handler: () => void): void {
    this.transport.onClose?.(handler);
  }

  async connect(): Promise<UpstreamServerInfo> {
    this.serverInfo = await this.transport.connect();
    return this.serverInfo;
  }

  info(): UpstreamServerInfo | null {
    return this.serverInfo;
  }

  async close(): Promise<void> {
    this.serverInfo = null;
    await this.transport.close();
  }

  async catalog(): Promise<UpstreamCatalog> {
    const info = this.serverInfo;
    if (!info) throw new UpstreamError('UPSTREAM_PROTOCOL', 'connect() must run before catalog()');
    const [tools, resources, prompts] = await Promise.all([
      this.list<UpstreamTool>(info, 'tools', 'tools/list'),
      this.list<UpstreamResource>(info, 'resources', 'resources/list'),
      this.list<UpstreamPrompt>(info, 'prompts', 'prompts/list'),
    ]);
    return { tools, resources, prompts };
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    return this.transport.request('tools/call', { name, arguments: args });
  }

  async readResource(uri: string): Promise<unknown> {
    return this.transport.request('resources/read', { uri });
  }

  async getPrompt(name: string, args?: unknown): Promise<unknown> {
    return this.transport.request('prompts/get', { name, arguments: args });
  }

  private async list<T>(
    info: UpstreamServerInfo,
    capability: string,
    method: string,
  ): Promise<T[]> {
    if (!info.capabilities[capability]) return [];
    let page = 0;
    try {
      const values: T[] = [];
      let cursor: string | undefined;
      const seen = new Set<string>();
      for (page = 0; page < 100; page += 1) {
        const params = cursor === undefined ? undefined : { cursor };
        const result = (await this.transport.request(method, params)) as Record<string, unknown>;
        const value = result?.[capability];
        if (!Array.isArray(value)) return [];
        values.push(...(value as T[]));
        const next = result?.nextCursor;
        if (next === undefined || next === null || next === '') return values;
        if (typeof next !== 'string' || seen.has(next)) return [];
        seen.add(next);
        cursor = next;
      }
      return [];
    } catch {
      if (page > 0)
        throw new UpstreamError('UPSTREAM_PROTOCOL', `${method} pagination was incomplete`);
      return [];
    }
  }
}
