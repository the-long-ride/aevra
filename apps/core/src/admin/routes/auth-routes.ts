import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AdminCredentialVerifier } from '../admin-credentials.js';
import type { AdminBootstrapService } from '../bootstrap.js';
import type { IpRateLimiter } from '../../mcp/rate-limit.js';
import { sendAdminResponse } from './http.js';

const LOGIN_BODY_LIMIT = 8 * 1024;
const ADMIN_COOKIE = 'aevra_admin';
const COOKIE_ATTRIBUTES = 'Secure; HttpOnly; SameSite=Strict; Path=/';

export interface AdminAuthRouteContext {
  sessions: AdminBootstrapService;
  credentialVerifier?: AdminCredentialVerifier;
  loginLimiter: IpRateLimiter;
  sessionId?: string;
  secure: boolean;
  sameOrigin: boolean;
  clientIp: string;
}

async function readLoginBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > LOGIN_BODY_LIMIT) {
      throw Object.assign(new Error('request body too large'), { status: 413 });
    }
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    throw Object.assign(new Error('invalid JSON'), { status: 400 });
  }
}

function setSessionCookie(response: ServerResponse, sessionId: string) {
  response.setHeader(
    'set-cookie',
    `${ADMIN_COOKIE}=${encodeURIComponent(sessionId)}; ${COOKIE_ATTRIBUTES}`,
  );
}

function clearSessionCookie(response: ServerResponse) {
  response.setHeader('set-cookie', `${ADMIN_COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`);
}

function rejectCsrf(response: ServerResponse) {
  sendAdminResponse(response, 403, {
    error: {
      code: 'CSRF_REJECTED',
      message: 'State-changing admin requests must be same-origin',
    },
  });
}

export async function handleAuthRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: AdminAuthRouteContext,
): Promise<boolean> {
  if (url.pathname === '/api/auth/session' && request.method === 'GET') {
    sendAdminResponse(response, 200, {
      authenticated: context.sessions.validateSession(context.sessionId),
    });
    return true;
  }

  if (url.pathname === '/api/auth/login' && request.method === 'POST') {
    if (!context.sameOrigin) {
      rejectCsrf(response);
      return true;
    }
    if (!context.secure) {
      sendAdminResponse(response, 400, {
        error: { code: 'HTTPS_REQUIRED', message: 'Admin login requires HTTPS' },
      });
      return true;
    }
    if (!context.loginLimiter.allow(context.clientIp)) {
      sendAdminResponse(response, 429, { error: 'Too many login attempts' });
      return true;
    }
    if (!context.credentialVerifier) {
      sendAdminResponse(response, 503, { error: 'Admin authentication unavailable' });
      return true;
    }

    let body: Record<string, unknown>;
    try {
      body = await readLoginBody(request);
    } catch (error) {
      const failure = error as { status?: number };
      sendAdminResponse(response, failure.status ?? 400, { error: 'Invalid request' });
      return true;
    }
    const username = typeof body.username === 'string' ? body.username : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const valid = await context.credentialVerifier.verify(username, password);
    if (!valid) {
      context.loginLimiter.recordFailure(context.clientIp);
      sendAdminResponse(response, 401, { error: 'Invalid credentials' });
      return true;
    }

    const session = await context.sessions.issueSession();
    setSessionCookie(response, session.sessionId);
    sendAdminResponse(response, 200, { authenticated: true });
    return true;
  }

  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    if (!context.sameOrigin) {
      rejectCsrf(response);
      return true;
    }
    if (!context.sessions.validateSession(context.sessionId)) {
      sendAdminResponse(response, 401, { error: 'admin session required' });
      return true;
    }
    context.sessions.revokeSession(context.sessionId);
    clearSessionCookie(response);
    sendAdminResponse(response, 200, { authenticated: false });
    return true;
  }

  return false;
}
