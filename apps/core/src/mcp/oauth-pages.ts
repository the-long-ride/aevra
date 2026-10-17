import { htmlEscape } from './http-response.js';

export function authorizationPage(requestId: string, pairingCode: string) {
  const id = htmlEscape(requestId);
  const code = htmlEscape(pairingCode);
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

  </div>
  <div class="status-row"><span class="status-mark" aria-hidden="true"></span><span id="status">Waiting for local approval...</span></div>
</main>
<script>
const id = ${JSON.stringify(requestId)};
const status = document.querySelector('#status');
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
export function oauthErrorPage(title: string, error: unknown) {
  const message = htmlEscape(error instanceof Error ? error.message : String(error));
  return `<!doctype html><meta charset="utf-8"><title>Aevra authorization</title><body style="font-family:system-ui;background:#0a0a0a;color:#fff;padding:32px"><h1>${title}</h1><p>${message}</p></body>`;
}
