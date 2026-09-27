import type { ActiveConnection } from './ConnectionDetailModal';

export function dateTime(value?: string) {
  if (!value) return '—';
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : new Date(time).toLocaleString();
}

function statusLabel(status?: string) {
  switch (status) {
    case 'CONNECTED':
      return 'Connected';
    case 'GRACE':
      return 'Reconnect grace';
    case 'OFFLINE':
      return 'Offline / reconnectable';
    case 'REVOKED':
      return 'Revoked';
    default:
      return status ?? 'active';
  }
}

export function ConnectionDetails({
  connection,
  durableOAuth,
}: {
  connection: ActiveConnection;
  durableOAuth: boolean;
}) {
  return (
    <dl className="details-grid">
      <div>
        <span>Auth</span>
        <strong>{connection.authType ?? 'Unknown'}</strong>
      </div>
      {durableOAuth ? (
        <>
          <div>
            <span>Connection status</span>
            <strong>{statusLabel(connection.status)}</strong>
          </div>
          <div>
            <span>Last used</span>
            <strong>{dateTime(connection.lastUsedAt ?? connection.lastActivityAt)}</strong>
          </div>
          <div>
            <span>YOLO</span>
            <strong>{connection.yolo ? 'Enabled' : 'Disabled'}</strong>
          </div>
          <div>
            <span>Reconnect grace</span>
            <strong>{connection.graceExpiresAt ? dateTime(connection.graceExpiresAt) : '—'}</strong>
          </div>
          <div>
            <span>Access token</span>
            <strong>
              {connection.accessTokenLifetimeSeconds
                ? `${Math.round(connection.accessTokenLifetimeSeconds / 60)} min lifetime`
                : '—'}
            </strong>
          </div>
          <div>
            <span>Refresh grant</span>
            <strong>
              {connection.refreshFamilyExpiresAt
                ? `${dateTime(connection.refreshFamilyExpiresAt)} (${connection.renewable ? 'Active' : 'Expired'})`
                : 'Not available (session-only)'}
            </strong>
          </div>
          <div>
            <span>Live sessions</span>
            <strong>{connection.sessionCount ?? 0}</strong>
          </div>
        </>
      ) : (
        <>
          <div>
            <span>Mode</span>
            <strong>
              {connection.yolo ? <span className="badge good">YOLO</span> : 'Confirm'}
            </strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{statusLabel(connection.status)}</strong>
          </div>
          <div>
            <span>Remote IP</span>
            <strong>{connection.remoteIp ?? 'Hidden'}</strong>
          </div>
        </>
      )}
    </dl>
  );
}
