import { useControlGrants, type ControlCapability, type ControlGrants } from './useControlGrants';

export type ConnectionControlGrants = ControlGrants;

export function ConnectionControlGrantsPanel({
  connectionId,
  onChanged,
}: {
  connectionId: string;
  onChanged(): Promise<void>;
}) {
  const base = `/api/connections/${encodeURIComponent(connectionId)}/control`;
  const { grants, busy, loadError, actionError, setGrant } = useControlGrants(base, onChanged);

  return (
    <section className="connection-workspaces" aria-label="Device control grants">
      <h3>Device control</h3>
      <p className="muted">
        Grant this exact AI connection access to browser tabs and desktop apps independently.
        Workspace access does not grant device control.
      </p>
      <p className="muted">Connection: {connectionId}</p>
      {grants ? (
        (['browser', 'desktop'] as const).map((kind) => {
          const enabled = grants[kind];
          const capability: ControlCapability = `${kind}.control`;
          return (
            <div key={kind} className="connection-grant">
              <span>
                {kind === 'browser' ? 'Browser control' : 'Desktop control'}:{' '}
                {enabled ? 'Granted' : 'Off'}
              </span>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void setGrant(capability, !enabled)}
              >
                {enabled ? 'Revoke' : 'Grant'} {kind} control
              </button>
            </div>
          );
        })
      ) : (
        <p className="muted">Loading device grants�</p>
      )}
      {loadError || actionError ? (
        <p role="alert" className="warning">
          {loadError || actionError}
        </p>
      ) : null}
    </section>
  );
}
