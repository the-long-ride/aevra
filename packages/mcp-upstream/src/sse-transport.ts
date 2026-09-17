import { PendingCalls } from './pending-calls.js';
import {
  MCP_PROTOCOL_VERSION,
  UpstreamError,
  parseJsonRpcMessage,
  type UpstreamServerInfo,
} from './protocol.js';
import {
  DEFAULT_DEADLINE_MS,
  EventStreamParser,
  fetchSameOrigin,
  safeHttpUrl,
  type UpstreamTransport,
} from './transport.js';

export interface SseTransportOptions {
  url: string;
  headers?: Record<string, string>;
  deadlineMs?: number;
}

export class SseTransport implements UpstreamTransport {
  private controller: AbortController | null = null;
  private postUrl: string | null = null;
  private streamUsable = false;
  private handler: (method: string, params: unknown) => void = () => {};
  private closedHandler: () => void = () => {};
  private resolveEndpoint: () => void = () => {};
  private rejectEndpoint: (error: Error) => void = () => {};
  private readonly calls: PendingCalls;
  private pendingPosts = new Set<{ controller: AbortController; cancel: () => void }>();

  constructor(private readonly options: SseTransportOptions) {
    safeHttpUrl(options.url);
    this.calls = new PendingCalls(options.deadlineMs ?? DEFAULT_DEADLINE_MS, () => {});
  }

  onNotification(handler: (method: string, params: unknown) => void): void {
    this.handler = handler;
  }

  onClose(handler: () => void): void {
    this.closedHandler = handler;
  }

  async connect(): Promise<UpstreamServerInfo> {
    await this.openStream();
    const result = (await this.request('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'aevra', version: '1' },
    })) as {
      protocolVersion?: string;
      serverInfo?: { name?: string; version?: string };
      capabilities?: Record<string, unknown>;
    };
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return {
      name: result.serverInfo?.name ?? 'unknown',
      version: result.serverInfo?.version ?? '0.0.0',
      protocolVersion: result.protocolVersion ?? MCP_PROTOCOL_VERSION,
      capabilities: result.capabilities ?? {},
    };
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    const generation = this.controller;
    const { id, promise } = this.calls.issue<unknown>(method);
    const observed = promise.catch((error: unknown) => {
      throw error;
    });
    observed.catch(() => {});
    try {
      await this.post({ jsonrpc: '2.0', id, method, params });
    } catch (error) {
      if (this.controller === generation)
        this.calls.failAll('UPSTREAM_CONNECT_FAILED', 'The upstream request could not be posted');
      throw error;
    }
    return observed;
  }

  async close(): Promise<void> {
    this.cancelPosts();
    this.controller?.abort();
    this.controller = null;
    this.postUrl = null;
    this.streamUsable = false;
    this.calls.failAll('UPSTREAM_DIED', 'The upstream event stream was closed');
  }

  private async openStream(): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    this.postUrl = null;
    this.streamUsable = false;
    const startupTimer = setTimeout(
      () => controller.abort(),
      this.options.deadlineMs ?? DEFAULT_DEADLINE_MS,
    );
    let response: Response;
    try {
      response = await fetchSameOrigin(this.options.url, {
        method: 'GET',
        headers: { accept: 'text/event-stream', ...this.options.headers },
        signal: controller.signal,
      });
    } catch (error) {
      throw new UpstreamError(
        'UPSTREAM_CONNECT_FAILED',
        `Could not open the upstream event stream at ${this.options.url}`,
        {
          cause: error instanceof Error ? error.name : 'unknown',
        },
      );
    } finally {
      clearTimeout(startupTimer);
    }
    if (!response.ok || !response.body) {
      throw new UpstreamError(
        'UPSTREAM_CONNECT_FAILED',
        `The upstream event stream returned ${response.status}`,
      );
    }
    const endpointReady = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        controller.abort();
        reject(
          new UpstreamError('UPSTREAM_CONNECT_FAILED', 'The upstream never sent an endpoint event'),
        );
      }, this.options.deadlineMs ?? DEFAULT_DEADLINE_MS);
      this.resolveEndpoint = () => {
        clearTimeout(timer);
        resolve();
      };
      this.rejectEndpoint = (error) => {
        clearTimeout(timer);
        reject(error);
      };
    });
    void this.pump(response.body, controller);
    try {
      await endpointReady;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  private async pump(body: ReadableStream<Uint8Array>, controller: AbortController): Promise<void> {
    const decoder = new TextDecoder();
    const parser = new EventStreamParser();
    try {
      for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
        if (this.controller !== controller) return;
        parser.push(decoder.decode(chunk, { stream: true }), (event) => this.absorbEvent(event));
      }
      parser.push(decoder.decode(), (event) => this.absorbEvent(event));
      parser.finish((event) => this.absorbEvent(event));
    } catch {
      // Aborts and dropped streams are reported by the sweep below.
    }
    if (this.controller === controller) {
      this.cancelPosts();
      this.controller = null;
      this.postUrl = null;
      this.streamUsable = false;
      this.calls.failAll('UPSTREAM_DIED', 'The upstream event stream ended');
      this.closedHandler();
    }
  }

  private absorbEvent(block: string): void {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split(/\r\n|\r|\n/)) {
      if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
      else if (line.startsWith('data:')) data.push(line.slice('data:'.length).trim());
    }
    const payload = data.join('\n');
    if (event === 'endpoint') {
      let endpoint: URL;
      try {
        endpoint = safeHttpUrl(new URL(payload, this.options.url).toString());
      } catch (error) {
        this.rejectEndpoint(
          error instanceof Error
            ? error
            : new UpstreamError('UPSTREAM_CONNECT_FAILED', 'The upstream endpoint is invalid'),
        );
        return;
      }
      if (endpoint.origin !== safeHttpUrl(this.options.url).origin) {
        this.rejectEndpoint(
          new UpstreamError(
            'UPSTREAM_CONNECT_FAILED',
            'The upstream advertised a credential-bearing endpoint on another origin',
          ),
        );
        return;
      }
      this.postUrl = endpoint.toString();
      this.streamUsable = true;
      this.resolveEndpoint();
      return;
    }
    const message = parseJsonRpcMessage(payload);
    if (!message) return;
    if (message.type === 'response') this.calls.settle(message.response);
    else this.handler(message.notification.method, message.notification.params);
  }

  private async post(message: unknown): Promise<void> {
    const url = this.postUrl;
    if (!url || !this.streamUsable)
      throw new UpstreamError('UPSTREAM_DIED', 'The upstream event stream is not open');
    const controller = new AbortController();
    const pending = { controller, cancel: () => {} };
    const cancellation = new Promise<never>((_, reject) => {
      pending.cancel = () =>
        reject(new UpstreamError('UPSTREAM_DIED', 'The upstream event stream was closed'));
    });
    this.pendingPosts.add(pending);
    try {
      const response = await Promise.race([
        fetchSameOrigin(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...this.options.headers },
          body: JSON.stringify(message),
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(this.options.deadlineMs ?? DEFAULT_DEADLINE_MS),
          ]),
        }),
        cancellation,
      ]);
      if (!response.ok) throw new Error(`status ${response.status}`);
    } catch (error) {
      if (error instanceof UpstreamError) throw error;
      throw new UpstreamError(
        'UPSTREAM_CONNECT_FAILED',
        'Could not post to the upstream endpoint',
        {
          cause: error instanceof Error ? error.name : 'unknown',
        },
      );
    } finally {
      this.pendingPosts.delete(pending);
    }
  }

  private cancelPosts(): void {
    for (const pending of this.pendingPosts) {
      pending.cancel();
      pending.controller.abort();
    }
    this.pendingPosts.clear();
  }
}
