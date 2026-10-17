import { authorizationPage, oauthErrorPage } from './oauth-pages.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AevraOAuthService } from '../auth/oauth.js';
import { IpRateLimiter } from './rate-limit.js';
import {
  applyOAuthCors,
  readJson,
  readOAuthParams,
  remoteIp,
  sendHtml,
  sendOAuthJson,
} from './http-response.js';

function isProtectedResourceMetadata(path: string) {
  return (
    path === '/.well-known/oauth-protected-resource' ||
    path === '/.well-known/oauth-protected-resource/mcp' ||
    path === '/mcp/.well-known/oauth-protected-resource'
  );
}

function isAuthorizationServerMetadata(path: string) {
  return (
    path === '/.well-known/oauth-authorization-server' ||
    path === '/.well-known/oauth-authorization-server/mcp' ||
    path === '/mcp/.well-known/oauth-authorization-server'
  );
}

function isOAuthSurface(path: string) {
  return (
    path.startsWith('/oauth/') ||
    path.startsWith('/.well-known/oauth-') ||
    path.startsWith('/mcp/.well-known/oauth-')
  );
}

// Dynamic client registration is unauthenticated by design (RFC 7591 open
// registration): 30 per-IP burst with 1/min refill, plus 60 global burst with 1/sec refill.
const perIpRegistrationLimiter = new IpRateLimiter(30, 1 / 60);
const globalRegistrationLimiter = new IpRateLimiter(60, 1);
const perIpAuthorizationLimiter = new IpRateLimiter(30, 1 / 60);
const globalAuthorizationLimiter = new IpRateLimiter(120, 1);

export async function handleOAuthRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  oauth?: AevraOAuthService,
  trustForwardedClientIp = false,
): Promise<boolean> {
  if (!oauth) return false;
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (
    method === 'OPTIONS' &&
    (isOAuthSurface(path) || path === '/mcp' || path.startsWith('/mcp/'))
  ) {
    applyOAuthCors(res);
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (isProtectedResourceMetadata(path) && method === 'GET') {
    sendOAuthJson(res, 200, oauth.protectedResourceMetadata());
    return true;
  }

  if (isAuthorizationServerMetadata(path) && method === 'GET') {
    sendOAuthJson(res, 200, oauth.authorizationServerMetadata());
    return true;
  }

  if (path === '/oauth/register' && method === 'POST') {
    const ip = remoteIp(req, trustForwardedClientIp);
    if (!perIpRegistrationLimiter.allow(ip) || !globalRegistrationLimiter.allow('global')) {
      const retryAfter = Math.max(
        perIpRegistrationLimiter.retryAfterSeconds(ip),
        globalRegistrationLimiter.retryAfterSeconds('global'),
      );
      res.setHeader('retry-after', String(retryAfter));
      sendOAuthJson(res, 429, { error: 'rate_limited' });
      return true;
    }
    try {
      const input = await readJson(req);
      sendOAuthJson(res, 201, oauth.registerClient(input));
    } catch (error) {
      sendOAuthJson(res, 400, {
        error: 'invalid_client_metadata',
        error_description: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  if (path === '/oauth/authorize' && method === 'GET') {
    const ip = remoteIp(req, trustForwardedClientIp);
    if (!perIpAuthorizationLimiter.allow(ip) || !globalAuthorizationLimiter.allow('global')) {
      res.setHeader(
        'retry-after',
        String(
          Math.max(
            perIpAuthorizationLimiter.retryAfterSeconds(ip),
            globalAuthorizationLimiter.retryAfterSeconds('global'),
          ),
        ),
      );
      sendOAuthJson(res, 429, { error: 'rate_limited' });
      return true;
    }
    try {
      const pending = oauth.beginAuthorization(
        {
          client_id: url.searchParams.get('client_id') ?? '',
          redirect_uri: url.searchParams.get('redirect_uri') ?? '',
          response_type: url.searchParams.get('response_type') ?? '',
          scope: url.searchParams.get('scope') ?? undefined,
          resource: url.searchParams.get('resource') ?? undefined,
          code_challenge: url.searchParams.get('code_challenge') ?? '',
          code_challenge_method: url.searchParams.get('code_challenge_method') ?? '',
          state: url.searchParams.get('state') ?? undefined,
        },
        remoteIp(req, trustForwardedClientIp),
      );
      sendHtml(res, 200, authorizationPage(pending.id, pending.pairingCode));
    } catch (error) {
      sendHtml(res, 400, oauthErrorPage('Connection request rejected', error));
    }
    return true;
  }

  if (path === '/oauth/authorize/status' && method === 'GET') {
    const status = oauth.authorizationStatus(url.searchParams.get('request_id') ?? '');
    sendOAuthJson(res, 200, { status: status.status });
    return true;
  }

  if (path === '/oauth/authorize/continue' && method === 'GET') {
    try {
      const result = oauth.continueAuthorization(url.searchParams.get('request_id') ?? '');
      res.statusCode = 302;
      res.setHeader('location', result.redirectUrl);
      res.setHeader('cache-control', 'no-store');
      res.end();
    } catch (error) {
      sendHtml(res, 409, oauthErrorPage('Authorization unavailable', error));
    }
    return true;
  }

  if (path === '/oauth/token' && method === 'POST') {
    try {
      const form = await readOAuthParams(req);
      const grant = form.get('grant_type');
      let result;
      if (grant === 'authorization_code') {
        result = oauth.exchangeAuthorizationCode({
          grant_type: 'authorization_code',
          client_id: form.get('client_id') ?? '',
          code: form.get('code') ?? '',
          redirect_uri: form.get('redirect_uri') ?? '',
          code_verifier: form.get('code_verifier') ?? '',
          resource: form.get('resource') ?? undefined,
        });
      } else if (grant === 'refresh_token') {
        result = oauth.exchangeRefreshToken({
          grant_type: 'refresh_token',
          client_id: form.get('client_id') ?? '',
          refresh_token: form.get('refresh_token') ?? '',
          resource: form.get('resource') ?? undefined,
          scope: form.get('scope') ?? undefined,
        });
      } else {
        throw new Error('unsupported grant_type');
      }
      sendOAuthJson(res, 200, result);
    } catch (error) {
      sendOAuthJson(res, 400, {
        error: 'invalid_grant',
        error_description: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  if (path === '/oauth/revoke' && method === 'POST') {
    let form: URLSearchParams;
    try {
      form = await readOAuthParams(req);
    } catch {
      sendOAuthJson(res, 400, { error: 'invalid_request' });
      return true;
    }
    oauth.revoke(form.get('token') ?? '');
    applyOAuthCors(res);
    res.statusCode = 200;
    res.setHeader('cache-control', 'no-store');
    res.end();
    return true;
  }

  if (isOAuthSurface(path)) {
    applyOAuthCors(res);
    res.statusCode = 404;
    res.setHeader('cache-control', 'no-store');
    res.end('Not Found');
    return true;
  }
  return false;
}
