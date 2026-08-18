import type { CloudflareStatus } from '@aevra/admin-contracts';
import { useState } from 'react';
import { requestJson } from '../../services/api-client';

export function RemoteAccessPanel({
  status,
  onChanged,
}: {
  status: CloudflareStatus;
  onChanged(): Promise<void>;
}) {
  const [message, setMessage] = useState('');
  const canonical = status.hostname
    ? `https://${status.hostname}/mcp`
    : 'Configure a public hostname first';

  const authenticate = async () => {
    try {
      const result = await requestJson<{ message?: string }>(
        '/api/cloudflare/authenticate',
        { method: 'POST', body: '{}' },
      );
      setMessage(result.message ?? 'Authentication checked.');
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const testEndpoint = async () => {
    try {
      const result = await requestJson<{
        reachable: boolean;
        status?: number;
        message?: string;
      }>('/api/cloudflare/test', { method: 'POST', body: '{}' });
      setMessage(
        result.reachable
          ? `Endpoint reachable${result.status ? ` (HTTP ${result.status})` : ''}`
          : `Not reachable: ${result.message ?? 'Unknown error'}`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const result = await requestJson<{ result: { hostname: string } }>(
        '/api/cloudflare/setup',
        {
          method: 'POST',
          body: JSON.stringify(Object.fromEntries(form)),
        },
      );
      setMessage(`Configured https://${result.result.hostname}`);
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="remote-access" data-surface-id="dashboard:remote-access">
      <div className="remote-access-head">
        <div className="remote-provider">
          <div>
            <b>cloudflared</b>
            <p>
              {status.found ? status.version ?? 'Detected' : 'Not detected on PATH'} ·{' '}
              {status.authenticationMessage ?? 'Authentication has not been checked.'}
            </p>
          </div>
          <span
            className={`status ${status.authenticated ? 'success' : status.found ? 'warning' : 'muted'}`}
          >
            {status.authenticated
              ? 'Authenticated'
              : status.found
                ? 'Login needed'
                : 'Unavailable'}
          </span>
        </div>
        <button type="button" disabled={!status.found} onClick={authenticate}>
          {status.authenticated ? 'Check authentication' : 'Authenticate'}
        </button>
      </div>
      <div className="endpoint remote-endpoint">
        <span>Canonical MCP endpoint</span>
        <code>{canonical}</code>
        {status.hostname ? (
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(canonical)}
          >
            Copy
          </button>
        ) : null}
      </div>
      <form className="remote-config" onSubmit={save}>
        <div className="remote-config-grid">
          <label className="field">
            <span>Public MCP hostname</span>
            <input name="hostname" defaultValue={status.hostname ?? ''} required />
          </label>
          <label className="field">
            <span>Tunnel ID</span>
            <input name="tunnelId" defaultValue={status.tunnelId ?? ''} />
          </label>
          <label className="field">
            <span>Tunnel ownership</span>
            <select name="ownership" defaultValue={status.ownership ?? 'managed'}>
              <option value="managed">Managed by Aevra</option>
              <option value="external">External process</option>
            </select>
          </label>
        </div>
        <input type="hidden" name="authMode" value="connector" />
        <div className="remote-actions">
          <p className="inline-result">{message}</p>
          <div className="actions">
            <button type="button" onClick={testEndpoint}>
              Test endpoint
            </button>
            <button className="primary">Save remote access</button>
          </div>
        </div>
      </form>
      <details>
        <summary>Advanced: Cloudflare Access</summary>
        <p>Optional extra gate. Aevra OAuth remains the normal authentication layer.</p>
      </details>
    </div>
  );
}
