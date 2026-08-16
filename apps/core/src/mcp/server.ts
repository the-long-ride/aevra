import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https, { type ServerOptions as HttpsServerOptions } from 'node:https';
import type { RemoteIdentityVerifier, VerifiedRemoteIdentity } from '../auth/cloudflare.js';
import type { AevraOAuthService } from '../auth/oauth.js';
import { handleJsonRpc } from '../../../../packages/mcp-tools/src/register.js';
import type { McpActivityLog } from './activity-log.js';
import { McpActivityRecorder } from './activity-recorder.js';
import { McpDiagnostics } from './diagnostics.js';
import { readJson, remoteIp, sendJson } from './http-response.js';
import {
  resolveMcpIdentity,
  type ConnectorAdmission,
  type ConnectorAdmissionOutcome,
} from './identity-resolver.js';
import { handleModernRuntimeRequest, type McpHookEmitter } from './modern-runtime.js';
import { MODERN_PROTOCOL_VERSION, isModernRequest } from './modern-protocol.js';
import { handleOAuthRoute } from './oauth-routes.js';
import { aevraServerInfo } from './server-info.js';

export type McpRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  identity: VerifiedRemoteIdentity,
) => Promise<void>;

export interface McpSessionRuntime {
  sessions: any;
  service: any;
}

export type { ConnectorAdmissionOutcome };
export type { ConnectorAdmission };

export interface McpIngressServerOptions {
  tls?: HttpsServerOptions;
  advertisedHost?: string;
  plainMcpEnabled?: boolean;
  oauth?: AevraOAuthService;
  activity?: McpActivityLog;
  hooks?: McpHookEmitter;
}

const LEGACY_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;

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
      code: -32022,
      message: 'Unsupported protocol version',
      data: {
        supported: [MODERN_PROTOCOL_VERSION, ...LEGACY_PROTOCOL_VERSIONS],
        requested,
      },
    },
  });
}

export class McpIngressServer {
  private server?: http.Server | https.Server;
  private readonly diagnostics = new McpDiagnostics();
  private readonly activity: McpActivityRecorder;

  constructor(
    private host: string,
    private port: number,
    private verifier?: RemoteIdentityVerifier,
    private handler?: McpRequestHandler,
    private safeMode: () => boolean = () => false,
    private runtime?: McpSessionRuntime,
    private connectors?: ConnectorAdmission,
    private options: McpIngressServerOptions = {},
  ) {
    this.activity = new McpActivityRecorder(options.activity, runtime?.sessions);
  }

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

    const identity = await resolveMcpIdentity(req, res, connectorMatch?.[1], {
      verifier: this.verifier,
      connectors: this.connectors,
      oauth: this.options.oauth,
      plainMcpEnabled: this.options.plainMcpEnabled,
    });
    if (!identity) return;

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
      this.disconnectLegacySession(res, sessionId, identity);
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }

    const body = await readJson(req);
    this.diagnostics.recordMethod(body?.method);
    if (isModernRequest(req, body)) {
      await handleModernRuntimeRequest(req, res, identity, body, {
        runtime: this.runtime!,
        diagnostics: this.diagnostics,
        activity: this.activity,
        hooks: this.options.hooks,
      });
      return;
    }

    const protocol = requestedProtocol(req, body);
    if (protocol && !LEGACY_PROTOCOL_VERSIONS.includes(protocol as any)) {
      unsupportedProtocol(res, body?.id, protocol);
      return;
    }
    if (body?.method === 'initialize') {
      this.initializeLegacySession(req, res, identity, body);
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
    if (body?.id === undefined && String(body?.method ?? '').startsWith('notifications/')) {
      res.statusCode = 202;
      res.setHeader('cache-control', 'no-store');
      res.end();
      return;
    }
    await this.dispatchLegacyRpc(res, identity.actor, sessionId, body);
  }

  private initializeLegacySession(
    req: IncomingMessage,
    res: ServerResponse,
    identity: VerifiedRemoteIdentity,
    body: any,
  ) {
    const session = this.runtime!.sessions.create(identity, remoteIp(req));
    this.diagnostics.recordIdentity(identity.actor, session.id);
    this.activity.session(identity.actor, session.id, 'initialize');
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
        serverInfo: aevraServerInfo(),
      },
    });
  }

  private disconnectLegacySession(
    res: ServerResponse,
    sessionId: string | undefined,
    identity: VerifiedRemoteIdentity,
  ) {
    if (!sessionId) {
      sendJson(res, 400, { error: 'MCP session id required' });
      return;
    }
    if (!this.sameIdentity(sessionId, identity)) {
      sendJson(res, 404, { error: 'MCP session not found' });
      return;
    }
    this.diagnostics.recordIdentity(identity.actor, sessionId);
    this.activity.session(identity.actor, sessionId, 'disconnect');
    this.runtime!.sessions.disconnect(sessionId);
    res.statusCode = 204;
    res.end();
  }

  private async dispatchLegacyRpc(
    res: ServerResponse,
    actor: string,
    sessionId: string,
    body: any,
  ) {
    if (body?.method === 'tools/call') {
      this.diagnostics.recordToolCall(body?.params?.name, sessionId);
    }
    const activity = this.activity.begin(
      actor,
      sessionId,
      body?.method,
      body?.params?.name,
      body?.method === 'tools/call' ? body?.params?.arguments : body?.params,
    );
    try {
      const result = await handleJsonRpc(this.runtime!.service, sessionId, body);
      this.activity.finish(activity, result);
      sendJson(res, 200, result);
    } catch (error) {
      this.activity.fail(activity, error);
      throw error;
    }
  }

  private sameIdentity(sessionId: string, identity: VerifiedRemoteIdentity) {
    const session = this.runtime?.sessions.get(sessionId);
    return Boolean(
      session && session.actor === identity.actor && session.subject === identity.subject,
    );
  }
}
