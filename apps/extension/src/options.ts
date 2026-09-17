export {};

const DEFAULT_ADMIN_PORT = 47831;
const PAIR_PATH = '/api/browser/pair';

const form = document.getElementById('pair') as HTMLFormElement;
const codeInput = document.getElementById('code') as HTMLInputElement;
const portInput = document.getElementById('port') as HTMLInputElement | null;
const statusLine = document.getElementById('status') as HTMLParagraphElement;

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void pair();
});

/** The operator who moved the admin port has moved this one too. */
function adminPort(): number {
  const parsed = Number(portInput?.value ?? '');
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : DEFAULT_ADMIN_PORT;
}

/**
 * Resolves to the response, or to null when the request never reached a server.
 * Only a transport failure may trigger the plaintext retry below: a TLS
 * response, whatever it said, means Aevra answered over TLS.
 */
async function post(scheme: 'https' | 'http', body: string): Promise<Response | null> {
  try {
    return await fetch(`${scheme}://127.0.0.1:${adminPort()}${PAIR_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
  } catch {
    return null;
  }
}

async function pair(): Promise<void> {
  statusLine.textContent = 'Pairing…';
  const body = JSON.stringify({
    code: codeInput.value.trim().toUpperCase(),
    extensionId: chrome.runtime.id,
  });
  // Admin listens TLS-only whenever a certificate exists, which is the default,
  // so https goes first. That certificate is self-signed and a service worker
  // cannot bypass a certificate error - but the pairing code is displayed in
  // the admin web UI, so the user has necessarily opened that origin in this
  // browser and accepted it already, and this fetch inherits that exception.
  let scheme: 'https' | 'http' = 'https';
  let response = await post('https', body);
  if (!response) {
    scheme = 'http';
    response = await post('http', body);
  }
  if (!response) {
    statusLine.textContent =
      `Pairing failed: Aevra is not reachable on port ${adminPort()}, or its ` +
      'certificate has not been accepted in this browser yet. Open the Aevra ' +
      'admin UI once in this browser, accept the certificate, then pair again.';
    return;
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    statusLine.textContent = `Pairing failed: ${payload?.error?.code ?? response.status}`;
    return;
  }
  // The token is stored and never logged or rendered.
  await chrome.storage.local.set({ token: payload.token, wsUrl: payload.wsUrl });
  chrome.runtime.sendMessage({ type: 'aevra:paired' });
  codeInput.value = '';
  statusLine.textContent = `Paired over ${scheme}.`;
}
