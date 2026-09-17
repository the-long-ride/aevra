import {
  MCP_PROTOCOL_VERSION,
  UpstreamError,
  parseJsonRpcMessage,
  type JsonRpcResponse,
  type UpstreamServerInfo,
} from './protocol.js';
import {
  DEFAULT_DEADLINE_MS,
  EventStreamParser,
  fetchSameOrigin,
  safeHttpUrl,
  type UpstreamTransport,
} from './transport.js';

export interface HttpTransportOptions {
  url: string;
  headers?: Record<string, string>;
  deadlineMs?: number;
}

interface PendingHttpRequest {
  controller: AbortController;
  cancel: () => void;
}

export class HttpTransport implements UpstreamTransport {
  private sessionId: string | null = null;
  private nextId = 1;
  private handler: (method: string, params: unknown) => void = () => {};
  private generation = 0;
  private pendingRequests = new Set<PendingHttpRequest>();
  private readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();

  constructor(private readonly options: HttpTransportOptions) {
    safeHttpUrl(options.url);
  }

  onNotification(handler: (method: string, params: unknown) => void): void {
    this.handler = handler;
  }

  async connect(): Promise<UpstreamServerInfo> {
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
    const id = this.nextId++;
    const body = await this.post({ jsonrpc: '2.0', id, method, params });
    if (body === null) throw new UpstreamError('UPSTREAM_PROTOCOL', `${method} returned no body`);
    if (body.error)
      throw new UpstreamError('UPSTREAM_CALL_FAILED', body.error.message, body.error.data);
    return body.result;
  }

  async close(): Promise<void> {
    this.generation += 1;
    this.sessionId = null;
    for (const pending of this.pendingRequests) {
      pending.controller.abort();
      pending.cancel();
    }
    for (const reader of this.readers) void reader.cancel().catch(() => {});
  }

  private async post(message: unknown): Promise<JsonRpcResponse | null> {
    const generation = this.generation;
    const controller = new AbortController();
    const pending: PendingHttpRequest = {
      controller,
      cancel: () => {},
    };
    const cancellation = new Promise<never>((_, reject) => {
      pending.cancel = () =>
        reject(new UpstreamError('UPSTREAM_DIED', 'The upstream HTTP transport was closed'));
    });
    this.pendingRequests.add(pending);
    const timer = setTimeout(
      () => controller.abort(),
      this.options.deadlineMs ?? DEFAULT_DEADLINE_MS,
    );
    const request = this.performPost(message, generation, controller);
    try {
      return await Promise.race([request, cancellation]);
    } finally {
      clearTimeout(timer);
      this.pendingRequests.delete(pending);
    }
  }

  private async performPost(
    message: unknown,
    generation: number,
    controller: AbortController,
  ): Promise<JsonRpcResponse | null> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...this.options.headers,
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;

    let response: Response;
    try {
      response = await fetchSameOrigin(this.options.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: controller.signal,
      });
    } catch (error) {
      this.assertGeneration(generation);
      throw new UpstreamError(
        'UPSTREAM_CONNECT_FAILED',
        `Could not reach the upstream server at ${this.options.url}`,
        { cause: error instanceof Error ? error.name : 'unknown' },
      );
    }

    this.assertGeneration(generation);
    const assigned = response.headers.get('mcp-session-id');
    if (assigned) this.sessionId = assigned;
    if (!response.ok)
      throw new UpstreamError(
        'UPSTREAM_CONNECT_FAILED',
        `The upstream server returned ${response.status}`,
      );
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType.includes('text/event-stream'))
      return this.readEventStream(
        response,
        typeof (message as { id?: unknown }).id === 'number'
          ? (message as { id: number }).id
          : undefined,
        controller,
        generation,
      );
    const text = await response.text();
    if (!text.trim()) return null;
    const parsed = parseJsonRpcMessage(text);
    const expectedId = (message as { id?: number }).id;
    if (!parsed || parsed.type !== 'response' || parsed.response.id !== expectedId)
      throw new UpstreamError(
        'UPSTREAM_PROTOCOL',
        'The upstream returned an invalid or mismatched JSON-RPC response',
      );
    return parsed.response;
  }

  private async readEventStream(
    response: Response,
    expectedId: number | undefined,
    controller: AbortController,
    generation: number,
  ): Promise<JsonRpcResponse> {
    if (!response.body)
      throw new UpstreamError('UPSTREAM_PROTOCOL', 'The upstream event stream has no body');
    const reader = response.body.getReader();
    this.readers.add(reader);
    const decoder = new TextDecoder();
    const parser = new EventStreamParser();
    let result: JsonRpcResponse | null = null;
    const consume = (event: string) => {
      if (result) return;
      this.assertGeneration(generation);
      const data = event
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trimStart())
        .join('\n');
      if (!data) return;
      const message = parseJsonRpcMessage(data);
      if (!message)
        throw new UpstreamError(
          'UPSTREAM_PROTOCOL',
          'The upstream event stream returned an invalid JSON-RPC message',
        );
      if (message.type === 'notification') {
        this.handler(message.notification.method, message.notification.params);
      } else if (expectedId === undefined || message.response.id === expectedId) {
        result = message.response;
      }
    };
    try {
      while (true) {
        this.assertGeneration(generation);
        const next = await reader.read();
        if (next.done) break;
        parser.push(decoder.decode(next.value, { stream: true }), consume);
        if (result) return result;
      }
      parser.push(decoder.decode(), consume);
      parser.finish(consume);
      if (result) return result;
    } catch (error) {
      if (generation !== this.generation)
        throw new UpstreamError('UPSTREAM_DIED', 'The upstream HTTP transport was closed');
      if (controller.signal.aborted)
        throw new UpstreamError('UPSTREAM_CONNECT_FAILED', 'The upstream HTTP request timed out');
      throw error;
    } finally {
      this.readers.delete(reader);
      await reader.cancel().catch(() => {});
    }
    throw new UpstreamError(
      'UPSTREAM_PROTOCOL',
      'The upstream event stream ended before the response',
    );
  }

  private assertGeneration(generation: number): void {
    if (generation !== this.generation)
      throw new UpstreamError('UPSTREAM_DIED', 'The upstream HTTP transport was closed');
  }
}
