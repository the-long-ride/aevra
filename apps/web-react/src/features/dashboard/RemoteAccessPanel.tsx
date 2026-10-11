import type { ExposureStatus } from '@aevra/admin-contracts';
import { useToast } from '../../components/Toast';
import { requestJson } from '../../services/api-client';

const PROVIDER_LABELS: Record<ExposureStatus['provider'], string> = {
  local: 'Local only',
  direct: 'Direct HTTPS',
  cloudflare: 'Cloudflare',
  ngrok: 'ngrok',
  external: 'External / Custom',
};

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
      {value ? (
        <button
          type="button"
          className="remote-copy-value"
          aria-label={copyLabel}
          title={copyLabel}
          onClick={() => void onCopy(label, value)}
        >
          <code>{value}</code>
        </button>
      ) : (
        <code>{fallback}</code>
      )}
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
  const { toast, success, error } = useToast();

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
      success(`Copied ${label}`, 'Copy succeeded');
    } catch (cause) {
      error(cause, 'Copy failed');
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
        success(
          `Endpoint reachable${result.publicUrl ? ` · ${result.publicUrl}` : ''}`,
          'Endpoint test succeeded',
        );
      } else {
        error(`Not reachable: ${result.message ?? result.state ?? 'Unknown error'}`);
      }
      await onChanged();
    } catch (cause) {
      error(cause);
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
      {toast}
    </div>
  );
}
