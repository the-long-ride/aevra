import type { WorkspaceSummary } from '@aevra/admin-contracts';
import { useEffect, useState } from 'react';
import { useDialog } from '../../components/Dialog';
import { Dropdown } from '../../components/Dropdown';
import { requestJson } from '../../services/api-client';

export interface ActiveConnection {
  id?: string;
  client?: string;
  actor?: string;
  provider?: string;
  authType?: string;
  yolo?: boolean;
  workspace?: string | null;
  workspaces?: string[];
  workspaceIds?: string[];
  capabilities?: string[];
  remoteIp?: string | null;
  connectedAt?: string;
  lastActivityAt?: string;
  status?: string;
}

export function ConnectionDetailModal({
  connection,
  workspaces,
  onClose,
  onChanged,
}: {
  connection: ActiveConnection | null;
  workspaces: WorkspaceSummary[];
  onClose(): void;
  onChanged(): Promise<void>;
}) {
  const dialog = useDialog();
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? '');
  const [error, setError] = useState('');

  useEffect(() => {
    setWorkspaceId(workspaces[0]?.id ?? '');
    setError('');
  }, [connection, workspaces]);

  if (!connection?.id) return null;

  const granted = connection.workspaceIds ?? [];
  const grantOptions = workspaces
    .filter((workspace) => !granted.includes(workspace.id))
    .map((workspace) => ({ value: workspace.id, label: workspace.name }));

  const run = async (action: () => Promise<void>) => {
    try {
      setError('');
      await action();
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const revoke = async () => {
    if (
      !(await dialog.confirm({
        title: 'Revoke session',
        message: `Disconnect ${connection.client ?? connection.id}?`,
        confirmLabel: 'Revoke',
        confirmTone: 'danger',
      }))
    ) {
      return;
    }
    await run(() =>
      requestJson(`/api/sessions/${encodeURIComponent(connection.id!)}/revoke`, {
        method: 'POST',
        body: '{}',
      }),
    );
    onClose();
  };

  const toggleYolo = async () => {
    const enable = connection.yolo !== true;
    if (
      enable &&
      !(await dialog.confirm({
        title: 'Enable YOLO session?',
        message: 'YOLO enabled — immutable security approvals still require confirmation',
        confirmLabel: 'Enable YOLO',
        confirmTone: 'yolo',
      }))
    ) {
      return;
    }
    await run(() =>
      requestJson(`/api/sessions/${encodeURIComponent(connection.id!)}/yolo`, {
        method: enable ? 'POST' : 'DELETE',
        body: '{}',
      }),
    );
  };

  const grantWorkspace = async () => {
    if (!workspaceId) return;
    await run(() =>
      requestJson(`/api/sessions/${encodeURIComponent(connection.id!)}/workspace`, {
        method: 'POST',
        body: JSON.stringify({ workspaceId, timeoutMs: 60000 }),
      }),
    );
  };

  const revokeWorkspace = async (id: string) => {
    await run(() =>
      requestJson(
        `/api/sessions/${encodeURIComponent(connection.id!)}/workspace/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      ),
    );
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-detail-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <h2 id="connection-detail-title">{connection.client ?? 'Connection'}</h2>
            <p className="muted">
              {connection.provider ?? connection.authType ?? 'Remote session'}
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-body connection-detail">
          <dl className="details-grid">
            <div>
              <span>Auth</span>
              <strong>{connection.authType ?? 'Unknown'}</strong>
            </div>
            <div>
              <span>Mode</span>
              <strong>
                {connection.yolo ? (
                  <span
                    className="badge good"
                    title="YOLO enabled — immutable security approvals still require confirmation"
                  >
                    YOLO
                  </span>
                ) : (
                  'Confirm'
                )}
              </strong>
            </div>
            <div>
              <span>Status</span>
              <strong>{connection.status ?? 'active'}</strong>
            </div>
            <div>
              <span>Remote IP</span>
              <strong>{connection.remoteIp ?? 'Hidden'}</strong>
            </div>
          </dl>
          <div className="connection-workspaces">
            <h3>Workspaces</h3>
            {granted.length ? (
              <ul>
                {granted.map((id, index) => (
                  <li key={id}>
                    <span>{connection.workspaces?.[index] ?? id}</span>
                    <button type="button" onClick={() => void revokeWorkspace(id)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No workspace granted to this chat session yet.</p>
            )}
            {grantOptions.length ? (
              <div className="connection-grant">
                <Dropdown
                  ariaLabel="Grant workspace"
                  value={workspaceId}
                  onChange={setWorkspaceId}
                  options={grantOptions}
                />
                <button type="button" onClick={() => void grantWorkspace()}>
                  Grant workspace
                </button>
              </div>
            ) : null}
          </div>
          {error ? <p className="warning">{error}</p> : null}
          <div className="actions">
            <button
              type="button"
              data-surface-id="connections:yolo"
              onClick={() => void toggleYolo()}
            >
              {connection.yolo ? 'Disable YOLO' : 'Enable YOLO'}
            </button>
            <button
              type="button"
              className="danger-button"
              data-surface-id="connections:revoke-session"
              onClick={() => void revoke()}
            >
              Revoke session
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
