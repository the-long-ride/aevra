import { useControlGrants, type ControlCapability } from './useControlGrants';

export function ConnectorControlGrants({
  connectorId,
  onChanged,
}: {
  connectorId: string;
  onChanged(): Promise<void>;
}) {
  const base = `/api/connectors/${encodeURIComponent(connectorId)}/control`;
  const { grants, busy, loadError, actionError, setGrant } = useControlGrants(base, onChanged);

  if (loadError)
    return (
      <span role="alert" className="warning">
        {loadError}
      </span>
    );
  if (!grants) return <span className="muted">Loading...</span>;
  return (
    <div className="connection-grant" aria-label={`Device control for ${connectorId}`}>
      {(['browser', 'desktop'] as const).map((kind) => {
        const enabled = grants[kind];
        const capability: ControlCapability = `${kind}.control`;
        return (
          <button
            key={kind}
            type="button"
            disabled={busy !== null}
            onClick={() => void setGrant(capability, !enabled)}
          >
            {enabled ? 'Revoke' : 'Grant'} {kind}
          </button>
        );
      })}
      {actionError ? (
        <p role="alert" className="warning">
          {actionError}
        </p>
      ) : null}
    </div>
  );
}
