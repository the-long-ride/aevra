import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AevraOAuthService } from '../auth/oauth.js';
import { IpRateLimiter } from './rate-limit.js';
import {
  applyOAuthCors,
  htmlEscape,
  readJson,
  readOAuthParams,
  remoteIp,
  sendHtml,
  sendOAuthJson,
} from './http-response.js';

function authorizationPage(requestId: string, pairingCode: string) {
  const id = htmlEscape(requestId);
  const code = htmlEscape(pairingCode);
  const command = `aevra oauth approve ${requestId} --code ${pairingCode}`;
  const displayCommand = htmlEscape(command);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Authorize Aevra</title>
<style>
:root { color-scheme: dark; font-family: "JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Consolas, monospace; background: #171515; color: #fdfcfc; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 20px; background: #171515; color: #fdfcfc; }
.panel { width: min(650px, 100%); border: 1px solid #393535; background: #1f1c1c; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; border-bottom: 1px solid #393535; }
.brand { font-size: 12px; font-weight: 700; letter-spacing: .08em; }
.state-dot { width: 7px; height: 7px; border: 1px solid #817979; background: #fdfcfc; }
.body { display: grid; gap: 18px; padding: 20px 16px; }
h1 { margin: 0; font-size: 18px; font-weight: 600; letter-spacing: -.02em; }
p { margin: 0; color: #c9c2c2; font-size: 12px; line-height: 1.65; }
.label { display: block; margin-bottom: 7px; color: #8f8787; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
.pairing { border: 1px solid #393535; background: #171515; padding: 13px; font-size: 21px; letter-spacing: .16em; overflow-wrap: anywhere; }
.copy-command { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; width: 100%; min-height: 48px; border: 1px solid #393535; border-radius: 0; background: #171515; padding: 0; color: #fdfcfc; cursor: pointer; text-align: left; font: inherit; }
.copy-command:hover, .copy-command:focus-visible { border-color: #fdfcfc; outline: none; }
.copy-command code { min-width: 0; overflow-x: auto; padding: 12px; color: #fdfcfc; white-space: pre; font: inherit; font-size: 11px; }
.copy-command span { align-self: stretch; display: grid; place-items: center; min-width: 70px; border-left: 1px solid #393535; padding: 0 10px; color: #a9a1a1; font-size: 10px; }
.status-row { display: flex; align-items: center; gap: 9px; border-top: 1px solid #393535; padding: 13px 16px; color: #a9a1a1; font-size: 11px; }
.status-mark { width: 6px; height: 6px; background: #fdfcfc; }
@media (max-width: 520px) { body { padding: 0; place-items: stretch; } .panel { min-height: 100vh; border-inline: 0; } .copy-command { grid-template-columns: minmax(0,1fr); } .copy-command span { min-height: 34px; border-top: 1px solid #393535; border-left: 0; } }
</style>
</head>
<body>
<main class="panel" data-aevra-oauth data-request-id="${id}">
  <div class="head"><span class="brand">AEVRA / OAUTH</span><span class="state-dot" aria-hidden="true"></span></div>
  <div class="body">
    <div>
      <h1>Authorize connection</h1>
      <p>Approve this connection in the local Aevra UI. Confirm the pairing code before allowing access.</p>
    </div>
    <div>
      <span class="label">Pairing code</span>
      <div class="pairing">${code}</div>
    </div>
    <div>
      <span class="label">Approve from a local terminal</span>
      <button class="copy-command" id="copy-command" type="button" title="Copy approval command">
        <code>${displayCommand}</code><span id="copy-state">Copy</span>
      </button>
    </div>
  </div>
  <div class="status-row"><span class="status-mark" aria-hidden="true"></span><span id="status">Waiting for local approval...</span></div>
</main>
<script>
const id = ${JSON.stringify(requestId)};
const cliCommand = ${JSON.stringify(command)};
const status = document.querySelector('#status');
const copyCommand = document.querySelector('#copy-command');
const copyState = document.querySelector('#copy-state');
copyCommand?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(cliCommand);
    if (copyState) copyState.textContent = 'Copied';
    setTimeout(() => { if (copyState) copyState.textContent = 'Copy'; }, 1600);
  } catch {
    if (copyState) copyState.textContent = 'Copy failed';
  }
});
async function poll() {
  try {
    const response = await fetch('/oauth/authorize/status?request_id=' + encodeURIComponent(id), { cache: 'no-store' });
    const value = await response.json();
    if (value.status === 'APPROVED') {
      if (status) status.textContent = 'Approved. Continuing...';
      location.replace('/oauth/authorize/continue?request_id=' + encodeURIComponent(id));
      return;
    }
    if (value.status === 'DENIED' || value.status === 'EXPIRED') {
      if (status) status.textContent = value.status === 'DENIED' ? 'Connection denied locally.' : 'Connection request expired.';
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
// registration), so bound how fast one address can create clients.
const registrationLimiter = new IpRateLimiter(3, 1 / 60);

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
    if (!registrationLimiter.allow(remoteIp(req))) {
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
    const form = await readOAuthParams(req);
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
