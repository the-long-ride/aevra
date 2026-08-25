import { existsSync, readFileSync, statSync } from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https, { type ServerOptions as HttpsServerOptions } from 'node:https';
import { IpRateLimiter } from '../mcp/rate-limit.js';
import type { AdminCredentialVerifier } from './admin-credentials.js';
import type { AdminBootstrapService } from './bootstrap.js';
import { secretEquals } from './bootstrap.js';
import { handleBulkAdminAction } from './bulk-actions.js';
import { buildDashboardRuntimeSnapshot } from './dashboard-runtime.js';
import { handleAdminApi, type AdminApiContext } from './routes/api.js';
import { handleAuthRoutes } from './routes/auth-routes.js';
import { resolveStaticAsset } from './static-files.js';

function json(res: ServerResponse, status: number, value: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(value));
}

function cookie(req: IncomingMessage, name: string) {
  const raw = req.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

function isMutation(req: IncomingMessage) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? 'GET');
}

function sameOrigin(req: IncomingMessage, url: URL) {
  if (!isMutation(req)) return true;
  const fetchSite = req.headers['sec-fetch-site'];
  if (typeof fetchSite === 'string' && !['same-origin', 'none'].includes(fetchSite)) {
    return false;
  }
  const origin = req.headers.origin;
  return typeof origin !== 'string' || origin === url.origin;
}

function staticContentType(file: string) {
  if (file.endsWith('.js') || file.endsWith('.mjs')) return 'text/javascript';
  if (file.endsWith('.css')) return 'text/css';
  if (file.endsWith('.json')) return 'application/json';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  if (file.endsWith('.png')) return 'image/png';
  return 'text/html';
}

export interface AdminServerOptions {
  bootstrap?: AdminBootstrapService;
  credentialVerifier?: AdminCredentialVerifier;
  loginLimiter?: IpRateLimiter;
  controlSecret?: string;
  staticDir?: string;
  api?: AdminApiContext;
  tls?: HttpsServerOptions;
  advertisedHost?: string;
}

export class AdminServer {
  private server?: http.Server | https.Server;
  private readonly startedAt = new Date().toISOString();
  private readonly loginLimiter: IpRateLimiter;

  constructor(
    private host: string,
    private port: number,
    private health: () => unknown,
    private options: AdminServerOptions = {},
  ) {
    this.loginLimiter = options.loginLimiter ?? new IpRateLimiter(5, 1 / 60);
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
  }

  address() {
    return this.server?.address();
  }

  url() {
    return `${this.options.tls ? 'https' : 'http'}://${this.options.advertisedHost ?? this.host}:${this.port}`;
  }

  async close() {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
  }

  private adminSession(req: IncomingMessage) {
    return cookie(req, 'aevra_admin');
  }

  private isAdmin(req: IncomingMessage) {
    return this.options.bootstrap?.validateSession(this.adminSession(req)) ?? false;
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', this.url());

    if (url.pathname === '/api/health') {
      json(res, 200, this.health());
      return;
    }

    if (url.pathname === '/api/local/logout-all' && req.method === 'POST') {
      if (
        !secretEquals(
          req.headers['x-aevra-control'] as string | undefined,
          this.options.controlSecret ?? '',
        )
      ) {
        json(res, 401, { error: 'unauthorized' });
        return;
      }
      await this.options.bootstrap!.revokeAll();
      json(res, 200, { ok: true });
      return;
    }

    if (url.pathname.startsWith('/api/auth/') && this.options.bootstrap) {
      const handled = await handleAuthRoutes(req, res, url, {
        sessions: this.options.bootstrap,
        credentialVerifier: this.options.credentialVerifier,
        loginLimiter: this.loginLimiter,
        sessionId: this.adminSession(req),
        secure: (req.socket as { encrypted?: boolean }).encrypted === true,
        sameOrigin: sameOrigin(req, url),
        clientIp: req.socket.remoteAddress ?? 'unknown',
      });
      if (handled) return;
    }

    if (url.pathname.startsWith('/api/') && !this.isAdmin(req)) {
      json(res, 401, { error: 'admin session required' });
      return;
    }

    if (url.pathname.startsWith('/api/') && !sameOrigin(req, url)) {
      json(res, 403, {
        error: {
          code: 'CSRF_REJECTED',
          message: 'State-changing admin requests must be same-origin',
        },
      });
      return;
    }

    if (url.pathname === '/api/status') {
      json(res, 200, { ...(this.health() as object), startedAt: this.startedAt });
      return;
    }

    if (url.pathname === '/api/dashboard/runtime') {
      json(
        res,
        200,
        buildDashboardRuntimeSnapshot(this.options.api ?? {}, this.health(), this.startedAt),
      );
      return;
    }

    if (
      url.pathname.startsWith('/api/') &&
      this.options.api &&
      (await handleBulkAdminAction(req, res, url, this.options.api, this.adminSession(req)))
    ) {
      return;
    }

    if (
      url.pathname.startsWith('/api/') &&
      this.options.api &&
      (await handleAdminApi(req, res, url, this.options.api))
    ) {
      return;
    }

    const staticDir = this.options.staticDir;
    if (staticDir) {
      const file = resolveStaticAsset(staticDir, url.pathname);
      if (file && existsSync(file) && statSync(file).isFile()) {
        res.setHeader('content-type', staticContentType(file));
        res.end(readFileSync(file));
        return;
      }
    }

    res.statusCode = 404;
    res.end('Not Found');
  }
}
