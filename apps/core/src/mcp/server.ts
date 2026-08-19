import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https, { type ServerOptions as HttpsServerOptions } from 'node:https';
import { AEVRA_VERSION } from '../version.js';
import {
  RejectingIdentityVerifier,
  type RemoteIdentityVerifier,
  type VerifiedRemoteIdentity,
} from '../auth/cloudflare.js';
import type { AevraOAuthService } from '../auth/oauth.js';
import { handleJsonRpc } from '../../../../packages/mcp-tools/src/register.js';
import { McpDiagnostics } from './diagnostics.js';
import { bearerToken, readJson, remoteIp, sendJson } from './http-response.js';
import { handleOAuthRoute } from './oauth-routes.js';

export type McpRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  identity: VerifiedRemoteIdentity,
) => Promise<void>;

export interface McpSessionRuntime {
  sessions: any;
  service: any;
}

export type ConnectorAdmissionOutcome =
  | { kind: 'admitted'; identity: VerifiedRemoteIdentity }
  | { kind: 'denied' }
  | { kind: 'rate-limited' };

export interface ConnectorAdmission {
  verify(token: string, ip: string): Promise<ConnectorAdmissionOutcome>;
}

export interface McpIngressServerOptions {
  tls?: HttpsServerOptions;
  advertisedHost?: string;
  plainMcpEnabled?: boolean;
  oauth?: AevraOAuthService;
}

const LEGACY_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;
const MODERN_PROTOCOL_VERSION = '2026-07-28';

function protocolHeader(req: IncomingMessage) {
  const value = req.headers['mcp-protocol-version'];
  return typeof value === 'string' ? value.trim() : undefined;
}

function protocolMeta(body: any) {
  const value = body?.params?._meta?.['io.modelcontextprotocol/protocolVersion'];
  return typeof value === 'string' ? value.trim() : undefined;
}

function requestedProtocol(req: IncomingMessage, body: any) {
  return protocolHeader(req) ?? protocolMeta(body);
}

function legacyProtocol(requested: unknown) {
  const value = typeof requested === 'string' ? requested : '';
  return LEGACY_PROTOCOL_VERSIONS.includes(value as any) ? value : LEGACY_PROTOCOL_VERSIONS[0];
}

function unsupportedProtocol(res: ServerResponse, id: unknown, requested: string) {
  sendJson(res, 400, {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code: -32602,
      message: 'Unsupported protocol version',
      data: { supported: [...LEGACY_PROTOCOL_VERSIONS], requested },
    },
  });
}

export class McpIngressServer {
  private server?: http.Server | https.Server;
  private readonly diagnostics = new McpDiagnostics();

  constructor(
    private host: string,
    private port: number,
    private verifier: RemoteIdentityVerifier = new RejectingIdentityVerifier(),
    private handler?: McpRequestHandler,
    private safeMode: () => boolean = () => false,
    private runtime?: McpSessionRuntime,
    private connectors?: ConnectorAdmission,
    private options: McpIngressServerOptions = {},
  ) {}

  async start() {
    const handler = (req: IncomingMessage, res: ServerResponse) => void this.handle(req, res);
    this.server = this.options.tls
      ? https.createServer(this.options.tls, handler)
      : http.createServer(handler);
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.port, this.host, resolve);
    });
    const address = this.server.address();
    if (address && typeof address !== 'string') this.port = address.port;
    this.diagnostics.listening();
  }

  address() {
    return this.server?.address();
  }

  url() {
    const protocol = this.options.tls ? 'https' : 'http';
    const host = this.options.advertisedHost ?? this.host;
    return `${protocol}://${host}:${this.port}`;
  }

  diagnosticsSnapshot() {
    return this.diagnostics.snapshot();
  }

  async close() {
    if (!this.server) {
      this.diagnostics.stopped();
      return;
    }
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
    this.diagnostics.stopped();
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', this.url());
    const path = url.pathname;
    if (path === '/health') {
      res.setHeader('content-type', 'application/json');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (await handleOAuthRoute(req, res, url, this.options.oauth)) return;

    const connectorMatch = path.match(/^\/mcp\/([A-Za-z0-9_-]+)$/);
    if (path !== '/mcp' && !connectorMatch) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }
    this.diagnostics.recordInbound(req.method ?? 'GET');

    if (this.safeMode()) {
      sendJson(res, 503, { error: 'SAFE_MODE' });
      return;
    }

    let identity: VerifiedRemoteIdentity;
    if (connectorMatch) {
      const outcome = await this.verifyConnector(connectorMatch[1]!, req);
      if (outcome.kind === 'rate-limited') {
        sendJson(res, 429, { error: 'rate_limited' });
        return;
      }
      if (outcome.kind !== 'admitted') {
        this.unauthorized(res);
        return;
      }
      identity = outcome.identity;
    } else {
      const resolved = await this.resolvePlainIdentity(req);
      if (!resolved) {
        this.unauthorized(res);
        return;
      }
      identity = resolved;
    }

    if (this.handler) {
      await this.handler(req, res, identity);
      return;
    }
    if (!this.runtime) {
      sendJson(res, 501, { error: 'MCP tools not wired' });
      return;
    }

    try {
      await this.handleRuntimeRequest(req, res, identity);
    } catch (error) {
      sendJson(res, (error as any)?.status ?? 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleRuntimeRequest(
    req: IncomingMessage,
    res: ServerResponse,
    identity: VerifiedRemoteIdentity,
  ) {
    const sessionHeader = req.headers['mcp-session-id'];
    const sessionId = typeof sessionHeader === 'string' ? sessionHeader : undefined;

    if (req.method === 'DELETE') {
      if (!sessionId) {
        sendJson(res, 400, { error: 'MCP session id required' });
        return;
      }
      if (!this.sameIdentity(sessionId, identity)) {
        sendJson(res, 404, { error: 'MCP session not found' });
        return;
      }
      this.diagnostics.recordIdentity(identity.actor, sessionId);
      this.runtime!.sessions.disconnect(sessionId);
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }

    const body = await readJson(req);
    this.diagnostics.recordMethod(body?.method);
    const protocol = requestedProtocol(req, body);
    if (protocol === MODERN_PROTOCOL_VERSION) {
      unsupportedProtocol(res, body?.id, protocol);
      return;
    }
    if (body?.method === 'server/discover') {
      unsupportedProtocol(res, body?.id, protocol || MODERN_PROTOCOL_VERSION);
      return;
    }

    if (body?.method === 'initialize') {
      const session = this.runtime!.sessions.create(identity, remoteIp(req));
      this.diagnostics.recordIdentity(identity.actor, session.id);
      res.setHeader('mcp-session-id', session.id);
      sendJson(res, 200, {
        jsonrpc: '2.0',
        id: body.id ?? null,
        result: {
          protocolVersion: legacyProtocol(body.params?.protocolVersion),
          capabilities: {
            tools: { listChanged: false },
            resources: { listChanged: false },
            prompts: { listChanged: false },
          },
          serverInfo: { name: 'Aevra', version: AEVRA_VERSION },
        },
      });
      return;
    }

    if (!sessionId) {
      sendJson(res, 400, { error: 'MCP session id required' });
      return;
    }
    if (!this.sameIdentity(sessionId, identity)) {
      sendJson(res, 404, { error: 'MCP session not found' });
      return;
    }

    this.diagnostics.recordIdentity(identity.actor, sessionId);
    this.runtime!.sessions.touch(sessionId);
    if (
      body?.id === undefined &&
      typeof body?.method === 'string' &&
      body.method.startsWith('notifications/')
    ) {
      res.statusCode = 202;
      res.setHeader('cache-control', 'no-store');
      res.end();
      return;
    }
    if (body?.method === 'tools/call') {
      this.diagnostics.recordToolCall(body?.params?.name, sessionId);
    }
    const result = await handleJsonRpc(this.runtime!.service, sessionId, body);
    sendJson(res, 200, result);
  }

  private async resolvePlainIdentity(req: IncomingMessage) {
    const token = bearerToken(req);
    if (token) return this.verifyBearerToken(token, req);
    if (this.options.plainMcpEnabled === false) return null;
    try {
      return await this.verifier.verifyRequest(req);
    } catch {
      return null;
    }
  }

  private async verifyBearerToken(
    token: string,
    req: IncomingMessage,
  ): Promise<VerifiedRemoteIdentity | null> {
    if (this.options.oauth) {
      try {
        return this.options.oauth.verifyAccessToken(token);
      } catch {
        // Fall through to static connector verification.
      }
    }
    const connector = await this.verifyConnector(token, req);
    return connector.kind === 'admitted' ? connector.identity : null;
  }

  private async verifyConnector(
    token: string,
    req: IncomingMessage,
  ): Promise<ConnectorAdmissionOutcome> {
    if (!this.connectors) return { kind: 'denied' };
    return this.connectors.verify(token, remoteIp(req));
  }

  private unauthorized(res: ServerResponse) {
    if (this.options.oauth) {
      const metadata = `${this.options.oauth.issuer}/.well-known/oauth-protected-resource/mcp`;
      res.setHeader('www-authenticate', `Bearer resource_metadata="${metadata}", scope="mcp"`);
    }
    sendJson(res, 401, { error: 'unauthorized' });
  }

  private sameIdentity(sessionId: string, identity: VerifiedRemoteIdentity) {
    const session = this.runtime?.sessions.get(sessionId);
    return Boolean(
      session && session.actor === identity.actor && session.subject === identity.subject,
    );
  }
}
