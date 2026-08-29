import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';
import https, {
  type Server as HttpsServer,
  type ServerOptions as HttpsServerOptions,
} from 'node:https';
import { pipeline } from 'node:stream/promises';
import type { LocalProtocol } from '../exposure/types.js';

export interface PublicGatewayTargets {
  adminUrl: string;
  mcpUrl: string;
}

export interface PublicGatewayOptions {
  host: string;
  port: number;
  protocol?: LocalProtocol;
  tls?: HttpsServerOptions;
  targets: PublicGatewayTargets;
  upstreamCa?: string | Buffer;
  gatewayTrustSecret?: string;
  /**
   * When this returns false, non-MCP paths are refused instead of forwarded to the
   * Admin plane. Publishing the gateway through a tunnel would otherwise expose the
   * Admin UI and its login endpoint alongside the intended MCP surface.
   */
  adminProxyEnabled?: () => boolean;
  /**
   * When true, forwarded client-IP headers are passed through because a declared
   * upstream proxy is authoritative for them. Routing headers stay stripped either way.
   */
  trustForwardedClientIp?: () => boolean;
}

export const ORIGINAL_TRANSPORT_HEADER = 'x-aevra-gateway-original-proto';
export const GATEWAY_TRUST_HEADER = 'x-aevra-gateway-trust';

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

/**
 * Inbound headers a client must never be able to set for itself.
 *
 * The forwarded client-IP entries matter as much as the routing ones: `remoteIp`
 * feeds rate limiting and the audit trail, so a client that could supply its own
 * address would be able to mint a fresh rate-limit bucket per request and forge
 * the origin recorded against every operation.
 */
/** Client-IP hints, believable only when an upstream proxy is declared trusted. */
export const CLIENT_IP_HEADERS = new Set(['cf-connecting-ip', 'true-client-ip', 'x-real-ip']);

/** Routing and trust headers a client may never set for itself, under any configuration. */
export const ALWAYS_STRIPPED_HEADERS = new Set([
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto',
  ORIGINAL_TRANSPORT_HEADER,
  GATEWAY_TRUST_HEADER,
]);

/** The default strip set: everything above, client-IP hints included. */
export const UNTRUSTED_FORWARDED_HEADERS = new Set([
  ...ALWAYS_STRIPPED_HEADERS,
  ...CLIENT_IP_HEADERS,
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

function requestHeaders(headers: IncomingHttpHeaders, trustClientIp = false): IncomingHttpHeaders {
  const connection = connectionTokens(headers);
  const out: IncomingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    const stripped = trustClientIp
      ? ALWAYS_STRIPPED_HEADERS.has(key)
      : UNTRUSTED_FORWARDED_HEADERS.has(key);
    if (
      value === undefined ||
      key === 'host' ||
      HOP_BY_HOP.has(key) ||
      connection.has(key) ||
      stripped
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
  private server?: HttpServer | HttpsServer;
  private port: number;

  constructor(private readonly options: PublicGatewayOptions) {
    this.port = options.port;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const handler = (request: IncomingMessage, response: ServerResponse) => {
      void this.proxy(request, response);
    };
    const protocol = this.options.protocol ?? 'https';
    if (protocol === 'https') {
      if (!this.options.tls) throw new Error('HTTPS public gateway requires TLS options');
      this.server = https.createServer(this.options.tls, handler);
    } else {
      this.server = http.createServer(handler);
    }
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
    return `${this.options.protocol ?? 'https'}://${this.options.host}:${this.port}`;
  }

  async close(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async proxy(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const inboundUrl = new URL(request.url ?? '/', this.url());
    const toMcp = usesMcpOrigin(inboundUrl.pathname);
    if (!toMcp && this.options.adminProxyEnabled?.() === false) {
      response.statusCode = 404;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not Found' } }));
      return;
    }
    const base = toMcp ? this.options.targets.mcpUrl : this.options.targets.adminUrl;
    const target = new URL(`${inboundUrl.pathname}${inboundUrl.search}`, base);

    const headers = requestHeaders(
      request.headers,
      this.options.trustForwardedClientIp?.() === true,
    );
    if (!toMcp && this.options.gatewayTrustSecret) {
      headers[ORIGINAL_TRANSPORT_HEADER] = this.options.protocol ?? 'https';
      headers[GATEWAY_TRUST_HEADER] = this.options.gatewayTrustSecret;
    }
    let upstream: ReturnType<typeof http.request> | undefined;
    try {
      const requestUpstream = target.protocol === 'https:' ? https.request : http.request;
      upstream = requestUpstream(
        target,
        {
          method: request.method,
          headers,
          ...(target.protocol === 'https:'
            ? { ca: this.options.upstreamCa, rejectUnauthorized: true }
            : {}),
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
