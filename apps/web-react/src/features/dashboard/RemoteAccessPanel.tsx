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

export function getHealthTone(value?: string | null): 'success' | 'danger' | 'warning' | 'mute' {
  if (!value) return 'mute';
  const norm = value.trim().toLowerCase();
  if (
    [
      'ready',
      'reachable',
      'healthy',
      'running',
      'listening',
      'ok',
      'connected',
      'active',
      'valid',
    ].includes(norm) ||
    norm.startsWith('ready') ||
    norm.startsWith('reachable') ||
    norm.startsWith('healthy') ||
    norm.startsWith('running') ||
    norm.startsWith('listening') ||
    norm.startsWith('connected')
  ) {
    return 'success';
  }
  if (
    [
      'unreachable',
      'error',
      'unavailable',
      'failed',
      'unhealthy',
      'missing',
      'stopped',
      'degraded',
      'disconnected',
    ].includes(norm) ||
    norm.startsWith('unreachable') ||
    norm.startsWith('error') ||
    norm.startsWith('unavailable') ||
    norm.startsWith('failed') ||
    norm.startsWith('unhealthy') ||
    norm.startsWith('missing')
  ) {
    return 'danger';
  }
  if (
    ['checking', 'pending', 'starting', 'reconnecting'].includes(norm) ||
    norm.startsWith('checking') ||
    norm.startsWith('pending')
  ) {
    return 'warning';
  }
  return 'mute';
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

  const providerTone: 'success' | 'danger' | 'warning' | 'mute' =
    status.state === 'ready'
      ? 'success'
      : status.state === 'error'
        ? 'danger'
        : getHealthTone(status.state);

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
            <p className={`status-${providerTone}`} data-status={providerTone}>
              {status.message ?? `Exposure is ${status.state}.`}
            </p>
          </div>
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
          {healthRows.map(([label, value]) => {
            const tone = getHealthTone(value);
            return (
              <div key={label} className="remote-health-item">
                <span>{label}</span>
                <strong className={`status-${tone}`} data-status={tone}>
                  {value}
                </strong>
              </div>
            );
          })}
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
