import { requestJson } from '../core/api.js';
import { escapeHtml, field } from '../core/dom.js';
import { toast } from './toast.js';

export function remoteAccessMarkup(cloudflare, id = 'remote') {
  const canonical = cloudflare?.hostname
    ? `https://${cloudflare.hostname}/mcp`
    : 'Configure a public hostname first';
  const detail = cloudflare?.found
    ? escapeHtml(cloudflare.version ?? 'Detected')
    : 'Not detected on PATH';
  const auth = escapeHtml(
    cloudflare?.authenticationMessage ??
      'Authentication has not been checked.',
  );
  return `<div class="remote-access">
    <div class="remote-access-head">
      <div class="remote-provider">
        <div><b>cloudflared</b><p>${detail} · ${auth}</p></div>
        <span class="status ${
          cloudflare?.authenticated
            ? 'success'
            : cloudflare?.found
              ? 'warning'
              : 'muted'
        }">${
          cloudflare?.authenticated
            ? 'Authenticated'
            : cloudflare?.found
              ? 'Login needed'
              : 'Unavailable'
        }</span>
      </div>
      <button type="button" id="${id}-authenticate" ${cloudflare?.found ? '' : 'disabled'}>
        ${cloudflare?.authenticated ? 'Check authentication' : 'Authenticate'}
      </button>
    </div>
    <div class="endpoint remote-endpoint">
      <span>Canonical MCP endpoint</span>
      <code>${escapeHtml(canonical)}</code>
      ${
        cloudflare?.hostname
          ? `<button type="button" data-copy-endpoint="${escapeHtml(canonical)}">Copy</button>`
          : ''
      }
    </div>
    <form id="${id}-cloudflare" class="remote-config">
      <div class="remote-config-grid">
        ${field(
          'Public MCP hostname',
          `<input name="hostname" value="${escapeHtml(cloudflare?.hostname ?? '')}" placeholder="aevra-mcp.example.com" required>`,
        )}
        ${field(
          'Tunnel ID',
          `<input name="tunnelId" value="${escapeHtml(cloudflare?.tunnelId ?? '')}" placeholder="Create or reuse tunnel">`,
        )}
        ${field(
          'Tunnel ownership',
          `<select name="ownership"><option value="managed">Managed by Aevra</option><option value="external" ${cloudflare?.ownership === 'external' ? 'selected' : ''}>External process</option></select>`,
        )}
      </div>
      <input type="hidden" name="authMode" value="connector">
      <div class="remote-actions">
        <p id="${id}-result" class="inline-result"></p>
        <div class="actions">
          <button type="button" id="${id}-test">Test endpoint</button>
          <button class="primary">Save remote access</button>
        </div>
      </div>
    </form>
    <details>
      <summary>Advanced: Cloudflare Access</summary>
      <p>Optional extra gate. Aevra OAuth remains the normal authentication layer.</p>
    </details>
  </div>`;
}

export function wireRemoteAccess(scope, cloudflare, id, reload) {
  scope
    .querySelector(`#${id}-authenticate`)
    ?.addEventListener('click', async () => {
      const output = scope.querySelector(`#${id}-result`);
      try {
        const result = await requestJson('/api/cloudflare/authenticate', {
          method: 'POST',
          body: '{}',
        });
        output.textContent = result.message ?? 'Authentication checked.';
        toast(output.textContent, 'success');
        await reload();
      } catch (error) {
        output.textContent = error.message;
        toast(error.message, 'error');
      }
    });

  scope
    .querySelector(`#${id}-cloudflare`)
    ?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const output = scope.querySelector(`#${id}-result`);
      try {
        const result = await requestJson('/api/cloudflare/setup', {
          method: 'POST',
          body: JSON.stringify(
            Object.fromEntries(new FormData(event.target)),
          ),
        });
        output.textContent = `Configured https://${result.result.hostname}`;
        toast(output.textContent, 'success');
        await reload();
      } catch (error) {
        output.textContent = error.message;
        toast(error.message, 'error');
      }
    });

  scope.querySelector(`#${id}-test`)?.addEventListener('click', async () => {
    const output = scope.querySelector(`#${id}-result`);
    try {
      const result = await requestJson('/api/cloudflare/test', {
        method: 'POST',
        body: '{}',
      });
      output.textContent = result.reachable
        ? `Endpoint reachable${result.status ? ` (HTTP ${result.status})` : ''}`
        : `Not reachable: ${result.message}`;
      toast(output.textContent, result.reachable ? 'success' : 'info');
    } catch (error) {
      output.textContent = error.message;
      toast(error.message, 'error');
    }
  });

  for (const button of scope.querySelectorAll('[data-copy-endpoint]')) {
    button.addEventListener('click', async () => {
      await navigator.clipboard.writeText(button.dataset.copyEndpoint);
      toast('Endpoint copied', 'success');
    });
  }
}
