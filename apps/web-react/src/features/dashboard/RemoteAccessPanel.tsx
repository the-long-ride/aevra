import type { ExposureStatus } from '@aevra/admin-contracts';
import { useEffect, useState } from 'react';
import { requestJson } from '../../services/api-client';

const PROVIDER_LABELS: Record<ExposureStatus['provider'], string> = {
  local: 'Local only',
  direct: 'Direct HTTPS',
  cloudflare: 'Cloudflare',
  ngrok: 'ngrok',
  external: 'External / Custom',
};

interface SuccessToast {
  message: string;
  ariaLabel: string;
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M6 5.5A1.5 1.5 0 0 1 7.5 4h5A1.5 1.5 0 0 1 14 5.5v5a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 6 10.5v-5Z" />
      <path d="M10 4V3.5A1.5 1.5 0 0 0 8.5 2h-5A1.5 1.5 0 0 0 2 3.5v5A1.5 1.5 0 0 0 3.5 10H4" />
    </svg>
  );
}

function RemoteEndpoint({
  label,
  value,
  fallback,
  onCopy,
}: {
  label: string;
  value?: string;
  fallback: string;
  onCopy(label: string, value: string): Promise<void>;
}) {
  const copyLabel = label.endsWith('URL') ? `Copy ${label}` : `Copy ${label} URL`;
  return (
    <div className="endpoint remote-endpoint">
      <span>{label}</span>
      <code>{value ?? fallback}</code>
      <button
        type="button"
        className="remote-copy-button"
        aria-label={copyLabel}
        title={copyLabel}
        disabled={!value}
        onClick={() => value && void onCopy(label, value)}
      >
        <CopyIcon />
      </button>
    </div>
  );
}

export function RemoteAccessPanel({
  status,
  onChanged,
}: {
  status: ExposureStatus;
  onChanged(): Promise<void>;
}) {
  const [message, setMessage] = useState('');
  const [successToast, setSuccessToast] = useState<SuccessToast | null>(null);

  useEffect(() => {
    if (!successToast) return undefined;
    const timer = window.setTimeout(() => setSuccessToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [successToast]);

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

  const copyUrl = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage('');
      setSuccessToast({ message: `Copied ${label}`, ariaLabel: 'Copy succeeded' });
    } catch (error) {
      setSuccessToast(null);
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const testEndpoint = async () => {
    try {
      const result = await requestJson<{
        reachable: boolean;
        state?: string;
        publicUrl?: string;
        message?: string;
      }>('/api/exposure/test', { method: 'POST', body: '{}' });
      if (result.reachable) {
        setMessage('');
        setSuccessToast({
          message: `Endpoint reachable${result.publicUrl ? ` · ${result.publicUrl}` : ''}`,
          ariaLabel: 'Endpoint test succeeded',
        });
      } else {
        setSuccessToast(null);
        setMessage(`Not reachable: ${result.message ?? result.state ?? 'Unknown error'}`);
      }
      await onChanged();
    } catch (error) {
      setSuccessToast(null);
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
        <RemoteEndpoint
          label="Local gateway"
          value={status.localGatewayUrl}
          fallback="Not started"
          onCopy={copyUrl}
        />
        <RemoteEndpoint
          label="Effective public URL"
          value={status.publicUrl}
          fallback="Not exposed"
          onCopy={copyUrl}
        />
        <RemoteEndpoint
          label="OAuth MCP resource"
          value={status.oauth?.resource}
          fallback="Not ready"
          onCopy={copyUrl}
        />
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
      {successToast ? (
        <div className="toast-stack">
          <div className="toast success" role="status" aria-label={successToast.ariaLabel}>
            {successToast.message}
          </div>
        </div>
      ) : null}
    </div>
  );
}
