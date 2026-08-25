import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import https, { type Server, type ServerOptions as HttpsServerOptions } from 'node:https';
import { pipeline } from 'node:stream/promises';

export interface PublicGatewayTargets {
  adminUrl: string;
  mcpUrl: string;
}

export interface PublicGatewayOptions {
  host: string;
  port: number;
  tls: HttpsServerOptions;
  targets: PublicGatewayTargets;
  upstreamCa?: string | Buffer;
}

const HOP_BY_HOP = new Set([
  'connection',
  'proxy-connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const UNTRUSTED_FORWARDED = new Set([
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto',
]);

function connectionTokens(headers: IncomingHttpHeaders): Set<string> {
  const raw = headers.connection;
  if (!raw) return new Set();
  return new Set(
    String(raw)
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

function requestHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const connection = connectionTokens(headers);
  const out: IncomingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (
      value === undefined ||
      key === 'host' ||
      HOP_BY_HOP.has(key) ||
      connection.has(key) ||
      UNTRUSTED_FORWARDED.has(key)
    ) {
      continue;
    }
    out[name] = value;
  }
  return out;
}

function responseHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const connection = connectionTokens(headers);
  const out: IncomingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (value === undefined || HOP_BY_HOP.has(key) || connection.has(key)) continue;
    out[name] = value;
  }
  return out;
}

function usesMcpOrigin(pathname: string): boolean {
  return (
    pathname === '/health' ||
    pathname === '/mcp' ||
    pathname.startsWith('/mcp/') ||
    pathname === '/oauth' ||
    pathname.startsWith('/oauth/') ||
    pathname === '/.well-known' ||
    pathname.startsWith('/.well-known/')
  );
}

function sendBadGateway(response: ServerResponse): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.statusCode = 502;
  response.setHeader('content-type', 'application/json');
  response.end(
    JSON.stringify({
      error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Gateway upstream unavailable' },
    }),
  );
}

export class PublicGateway {
  private server?: Server;
  private port: number;

  constructor(private readonly options: PublicGatewayOptions) {
    this.port = options.port;
  }

  async start(): Promise<void> {
    if (this.server) return;
    this.server = https.createServer(this.options.tls, (request, response) => {
      void this.proxy(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.port, this.options.host, resolve);
    });
    const address = this.server.address();
    if (address && typeof address !== 'string') this.port = address.port;
  }

  address() {
    return this.server?.address();
  }

  url(): string {
    return `https://${this.options.host}:${this.port}`;
  }

  async close(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async proxy(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const inboundUrl = new URL(request.url ?? '/', this.url());
    const base = usesMcpOrigin(inboundUrl.pathname)
      ? this.options.targets.mcpUrl
      : this.options.targets.adminUrl;
    const target = new URL(`${inboundUrl.pathname}${inboundUrl.search}`, base);

    let upstream: ReturnType<typeof https.request> | undefined;
    try {
      upstream = https.request(
        target,
        {
          method: request.method,
          headers: requestHeaders(request.headers),
          ca: this.options.upstreamCa,
          rejectUnauthorized: true,
        },
        (upstreamResponse) => {
          response.statusCode = upstreamResponse.statusCode ?? 502;
          for (const [name, value] of Object.entries(responseHeaders(upstreamResponse.headers))) {
            if (value !== undefined) response.setHeader(name, value);
          }
          void pipeline(upstreamResponse, response).catch(() => {
            response.destroy();
          });
        },
      );
      upstream.once('error', () => sendBadGateway(response));
      request.once('aborted', () => upstream?.destroy());
      await pipeline(request, upstream);
    } catch {
      upstream?.destroy();
      sendBadGateway(response);
    }
  }
}
