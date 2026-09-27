import { createServer, type Server } from 'node:http';
import { WebSocketServer } from './ws-test-server.js';

export type CdpHandler = (params: any, page: string) => unknown;

/** Returned by a handler to leave a CDP request unanswered. */
export const NO_REPLY = Symbol('no reply');
/** Wraps a frame the fake sends verbatim instead of a normal `result`. */
export class RawReply {
  constructor(readonly frame: unknown) {}
}

export interface FakePageSpec {
  id: string;
  url?: string;
  title?: string;
  type?: string;
  /** A target Chrome lists without a debugger websocket. */
  noSocket?: boolean;
}

/**
 * A loopback stand-in for Chrome's DevTools endpoint: `/json/*` over HTTP and
 * one WebSocket per page answering CDP methods from per-test handlers.
 */
export class FakeCdp {
  readonly requests: string[] = [];
  readonly calls: Array<{ page: string; method: string; params: any }> = [];
  readonly handlers: Record<string, CdpHandler> = {};
  status = 200;
  port = 0;
  private readonly pushers = new Map<string, (data: string) => void>();
  private readonly sockets: WebSocketServer[] = [];
  private server: Server | null = null;
  private list: Array<Record<string, unknown>> = [];

  static async start(pages: FakePageSpec[]): Promise<FakeCdp> {
    const fake = new FakeCdp();
    for (const page of pages) await fake.addPage(page);
    fake.server = createServer((request, response) => {
      const url = String(request.url ?? '');
      fake.requests.push(`${request.method} ${url}`);
      response.setHeader('content-type', 'application/json');
      if (url === '/json/list') {
        response.statusCode = fake.status;
        response.end(JSON.stringify(fake.list));
        return;
      }
      const closed = /^\/json\/close\/(.+)$/.exec(url);
      if (closed) fake.list = fake.list.filter((entry) => entry.id !== closed[1]);
      response.end('{}');
    });
    await new Promise<void>((resolve) => fake.server!.listen(0, '127.0.0.1', resolve));
    fake.port = (fake.server.address() as { port: number }).port;
    return fake;
  }

  async addPage(page: FakePageSpec): Promise<void> {
    const entry: Record<string, unknown> = {
      id: page.id,
      type: page.type ?? 'page',
      url: page.url ?? `https://${page.id}.example/`,
      title: page.title ?? page.id,
    };
    if (!page.noSocket) {
      const socket = await WebSocketServer.start((message, reply, push) => {
        this.pushers.set(page.id, push);
        const request = JSON.parse(message) as { id: number; method: string; params: any };
        this.calls.push({ page: page.id, method: request.method, params: request.params });
        let result: unknown;
        try {
          result = this.answer(page.id, String(entry.url), request.method, request.params);
        } catch (error) {
          reply(JSON.stringify({ id: request.id, error: { message: (error as Error).message } }));
          return;
        }
        if (result === NO_REPLY) return;
        if (result instanceof RawReply) {
          reply(JSON.stringify({ id: request.id, ...(result.frame as object) }));
          return;
        }
        reply(JSON.stringify({ id: request.id, result }));
      });
      this.sockets.push(socket);
      entry.webSocketDebuggerUrl = socket.url;
    }
    this.list.push(entry);
  }

  private answer(page: string, url: string, method: string, params: any): unknown {
    const handler = this.handlers[`${page}:${method}`] ?? this.handlers[method];
    if (handler) return handler(params, page);
    if (method === 'Page.getNavigationHistory') return { currentIndex: 0, entries: [{ url }] };
    return {};
  }

  /** Sends an unsolicited frame (a CDP event) to a page's connected client. */
  push(page: string, message: unknown): void {
    const push = this.pushers.get(page);
    if (!push) throw new Error(`page ${page} has no connected client`);
    push(typeof message === 'string' ? message : JSON.stringify(message));
  }

  methods(page?: string): string[] {
    return this.calls.filter((call) => !page || call.page === page).map((call) => call.method);
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) await socket.stop();
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
