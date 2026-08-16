import type { ExposureStatus } from '@aevra/admin-contracts';
import { useState } from 'react';
import { requestJson } from '../../services/api-client';

const PROVIDER_LABELS: Record<ExposureStatus['provider'], string> = {
  local: 'Local only',
  direct: 'Direct HTTPS',
  cloudflare: 'Cloudflare',
  ngrok: 'ngrok',
  external: 'External / Custom',
};

export function RemoteAccessPanel({
  status,
  onChanged,
}: {
  status: ExposureStatus;
  onChanged(): Promise<void>;
}) {
  const [message, setMessage] = useState('');
  const health = status.health;
  const healthRows = health
    ? [
        ['Provider process', health.providerProcess],
        ['Gateway', health.gateway],
        ['Public HTTPS', health.publicHttps],
        ['Admin', health.admin],
        ['MCP', health.mcp],
        ['OAuth', health.oauth],
        ['TLS', health.tls],
      ].filter((entry): entry is [string, string] => Boolean(entry[1]))
    : [];

  const testEndpoint = async () => {
    try {
      const result = await requestJson<{
        reachable: boolean;
        state?: string;
        publicUrl?: string;
        message?: string;
      }>('/api/exposure/test', { method: 'POST', body: '{}' });
      setMessage(
        result.reachable
          ? `Endpoint reachable${result.publicUrl ? ` · ${result.publicUrl}` : ''}`
          : `Not reachable: ${result.message ?? result.state ?? 'Unknown error'}`,
      );
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div
      className="remote-access remote-access-status"
      data-surface-id="dashboard:remote-access"
      data-testid="remote-access-status"
    >
      <div className="remote-access-head">
        <div className="remote-provider">
          <div>
            <b>{PROVIDER_LABELS[status.provider]}</b>
            <p>{status.message ?? `Exposure is ${status.state}.`}</p>
          </div>
          <span
            className={`status ${status.state === 'ready' ? 'success' : status.state === 'error' ? 'warning' : 'muted'}`}
          >
            {status.state}
          </span>
        </div>
        <button type="button" onClick={testEndpoint}>
          Test endpoint
        </button>
      </div>
      <div className="remote-status-grid">
        <div className="endpoint remote-endpoint">
          <span>Local gateway</span>
          <code>{status.localGatewayUrl ?? 'Not started'}</code>
        </div>
        <div className="endpoint remote-endpoint">
          <span>Effective public URL</span>
          <code>{status.publicUrl ?? 'Not exposed'}</code>
        </div>
        <div className="endpoint remote-endpoint">
          <span>OAuth MCP resource</span>
          <code>{status.oauth?.resource ?? 'Not ready'}</code>
        </div>
      </div>
      {healthRows.length ? (
        <div className="remote-health-grid" aria-label="Exposure health">
          {healthRows.map(([label, value]) => (
            <div key={label} className="remote-health-item">
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      ) : null}
      {status.checkedAt ? (
        <p className="remote-health-checked">
          <span>Last checked</span> <time dateTime={status.checkedAt}>{status.checkedAt}</time>
        </p>
      ) : null}
      {status.restartRequired ? (
        <p className="inline-result warning-text">
          Restart required to apply the listener binding change.
        </p>
      ) : null}
      {message ? <p className="inline-result">{message}</p> : null}
    </div>
  );
}
