import type { TransportValidationSnapshot } from '@aevra/admin-contracts';
import { ManagementModal } from '../../components/ManagementModal';

function EndpointRow({
  label,
  endpoint,
}: {
  label: string;
  endpoint: { url: string; protocol: 'http' | 'https'; encrypted: boolean; loopback: boolean };
}) {
  return (
    <div className="transport-validation-row">
      <div>
        <strong>{label}</strong>
        <code>{endpoint.url}</code>
      </div>
      <div className="transport-validation-badges">
        <span className={`badge ${endpoint.encrypted ? 'good' : 'warn'}`}>
          {endpoint.protocol.toUpperCase()}
        </span>
        <span className={`badge ${endpoint.loopback ? 'good' : 'warn'}`}>
          {endpoint.loopback ? 'Loopback' : 'Network exposed'}
        </span>
      </div>
    </div>
  );
}

export function TransportValidationModal({
  open,
  transport,
  onClose,
}: {
  open: boolean;
  transport?: TransportValidationSnapshot;
  onClose(): void;
}) {
  const issues = transport?.issues ?? [];
  return (
    <ManagementModal open={open} title="Transport validation" onClose={onClose}>
      {!transport ? (
        <p className="section-note">
          Transport validation is unavailable for this runtime snapshot.
        </p>
      ) : (
        <div className="transport-validation">
          <p className={transport.state === 'invalid' ? 'warning' : 'section-note'}>
            {transport.summary}
          </p>
          <div className="transport-validation-list">
            <EndpointRow label="Local gateway" endpoint={transport.gateway} />
            <EndpointRow label="Admin" endpoint={transport.admin} />
            <EndpointRow label="MCP ingress" endpoint={transport.mcp} />
            {transport.public.url ? (
              <div className="transport-validation-row">
                <div>
                  <strong>Public exposure</strong>
                  <code>{transport.public.url}</code>
                </div>
                <div className="transport-validation-badges">
                  <span className={`badge ${transport.public.encrypted ? 'good' : 'warn'}`}>
                    {transport.public.protocol?.toUpperCase() ?? 'Invalid'}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
          {issues.length ? (
            <ul className="transport-validation-issues">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </ManagementModal>
  );
}
