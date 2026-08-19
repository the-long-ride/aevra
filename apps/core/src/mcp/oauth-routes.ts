import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AevraOAuthService } from '../auth/oauth.js';
import {
  htmlEscape,
  readJson,
  readText,
  remoteIp,
  sendHtml,
  sendOAuthJson,
} from './http-response.js';

function authorizationPage(requestId: string, pairingCode: string) {
  const id = htmlEscape(requestId);
  const code = htmlEscape(pairingCode);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize Aevra</title>
<style>
body { font-family: Inter, system-ui, -apple-system, sans-serif; background: #0a0a0a; color: #fff; margin: 0; min-height: 100vh; display: grid; place-items: center; }
.panel { width: min(520px, calc(100% - 32px)); border: 1px solid #212327; border-radius: 8px; background: #191919; padding: 24px; }
h1 { font-size: 22px; font-weight: 400; margin: 0 0 8px; }
p { color: #dadbdf; line-height: 1.5; }
.code { font: 400 24px ui-monospace, monospace; letter-spacing: .12em; color: #fff; margin: 18px 0; }
.status { font-size: 13px; color: #dadbdf; }
</style>
</head>
<body>
<main class="panel" data-request-id="${id}">
<h1>Authorize Aevra</h1>
<p>Approve this connection in the local Aevra UI. Confirm the pairing code before allowing access.</p>
<div class="code">${code}</div>
<p class="status" id="status">Waiting for local approval...</p>
</main>
<script>
const id = ${JSON.stringify(requestId)};
const status = document.querySelector('#status');
async function poll() {
  try {
    const response = await fetch('/oauth/authorize/status?request_id=' + encodeURIComponent(id), { cache: 'no-store' });
    const value = await response.json();
    if (value.status === 'APPROVED') {
      location.replace('/oauth/authorize/continue?request_id=' + encodeURIComponent(id));
      return;
    }
    if (value.status === 'DENIED' || value.status === 'EXPIRED') {
      status.textContent = value.status === 'DENIED' ? 'Connection denied locally.' : 'Connection request expired.';
      return;
    }
  } catch {}
  setTimeout(poll, 1200);
}
poll();
</script>
</body>
</html>`;
}

function oauthErrorPage(title: string, error: unknown) {
  const message = htmlEscape(error instanceof Error ? error.message : String(error));
  return `<!doctype html><meta charset="utf-8"><title>Aevra authorization</title><body style="font-family:system-ui;background:#0a0a0a;color:#fff;padding:32px"><h1>${title}</h1><p>${message}</p></body>`;
}

export async function handleOAuthRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  oauth?: AevraOAuthService,
): Promise<boolean> {
  if (!oauth) return false;
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (
    (path === '/.well-known/oauth-protected-resource' ||
      path === '/.well-known/oauth-protected-resource/mcp') &&
    method === 'GET'
  ) {
    sendOAuthJson(res, 200, oauth.protectedResourceMetadata());
    return true;
  }

  if (
    (path === '/.well-known/oauth-authorization-server' ||
      path === '/.well-known/oauth-authorization-server/mcp') &&
    method === 'GET'
  ) {
    sendOAuthJson(res, 200, oauth.authorizationServerMetadata());
    return true;
  }

  if (path === '/oauth/register' && method === 'POST') {
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
        remoteIp(req),
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
      const form = new URLSearchParams(await readText(req));
      const grant = form.get('grant_type');
      let result;
      if (grant === 'authorization_code') {
        result = oauth.exchangeAuthorizationCode({
          grant_type: 'authorization_code',
          client_id: form.get('client_id') ?? '',
          code: form.get('code') ?? '',
          redirect_uri: form.get('redirect_uri') ?? '',
          code_verifier: form.get('code_verifier') ?? '',
          resource: form.get('resource') ?? '',
        });
      } else if (grant === 'refresh_token') {
        result = oauth.exchangeRefreshToken({
          grant_type: 'refresh_token',
          client_id: form.get('client_id') ?? '',
          refresh_token: form.get('refresh_token') ?? '',
          resource: form.get('resource') ?? '',
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
    const form = new URLSearchParams(await readText(req));
    oauth.revoke(form.get('token') ?? '');
    res.statusCode = 200;
    res.setHeader('cache-control', 'no-store');
    res.end();
    return true;
  }

  if (path.startsWith('/oauth/') || path.startsWith('/.well-known/oauth-')) {
    res.statusCode = 404;
    res.setHeader('cache-control', 'no-store');
    res.end('Not Found');
    return true;
  }
  return false;
}
