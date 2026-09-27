import type { WorkspaceSummary } from '@aevra/admin-contracts';
import { useEffect, useState } from 'react';
import { useDialog } from '../../components/Dialog';
import { Dropdown } from '../../components/Dropdown';
import { requestJson } from '../../services/api-client';
import { ConnectionControlGrantsPanel } from './ConnectionControlGrants';
import { ConnectionDetails, dateTime } from './ConnectionDetails';

export interface ActiveConnection {
  id?: string;
  connectionId?: string;
  sessionId?: string;
  sessionCount?: number;
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
  lastUsedAt?: string;
  graceExpiresAt?: string;
  refreshFamilyExpiresAt?: string;
  accessTokenLifetimeSeconds?: number;
  renewable?: boolean;
  status?: string;
  recentOrigins?: { remoteIp: string; lastSeenAt: string }[];
  workspaceGrants?: { workspaceId: string; profileId: string }[];
}

const PROFILE_OPTIONS = [
  { value: 'read-only', label: 'Read Only' },
  { value: 'coding-session', label: 'Coding Session' },
  { value: 'developer', label: 'Developer' },
  { value: 'full-workspace', label: 'Full Workspace' },
];

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
  const [grantProfile, setGrantProfile] = useState('read-only');
  const [error, setError] = useState('');

  useEffect(() => {
    setWorkspaceId(workspaces[0]?.id ?? '');
    setGrantProfile('read-only');
    setError('');
  }, [connection, workspaces]);

  if (!connection?.id) return null;

  const durableOAuth = connection.authType === 'OAuth' && Boolean(connection.connectionId);
  const sessionId = connection.sessionId ?? (durableOAuth ? undefined : connection.id);
  const canManageWorkspaces = Boolean(sessionId || (durableOAuth && connection.connectionId));
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
    const target = durableOAuth ? connection.connectionId! : sessionId!;
    const noun = durableOAuth ? 'connection' : 'session';
    if (
      !(await dialog.confirm({
        title: `Revoke ${noun}`,
        message: durableOAuth
          ? `Revoke ${connection.client ?? target} OAuth credentials and prevent silent resume?`
          : `Disconnect ${connection.client ?? target}?`,
        confirmLabel: durableOAuth ? 'Revoke connection' : 'Revoke',
        confirmTone: 'danger',
      }))
    ) {
      return;
    }
    await run(() =>
      requestJson(
        durableOAuth
          ? `/api/connections/${encodeURIComponent(target)}/revoke`
          : `/api/sessions/${encodeURIComponent(target)}/revoke`,
        { method: 'POST', body: '{}' },
      ),
    );
    onClose();
  };

  const toggleYolo = async () => {
    if (!sessionId) return;
    const enable = connection.yolo !== true;
    if (
      enable &&
      !(await dialog.confirm({
        title: `Enable YOLO ${durableOAuth ? 'connection' : 'session'}?`,
        message: 'YOLO enabled — immutable security approvals still require confirmation',
        confirmLabel: 'Enable YOLO',
        confirmTone: 'yolo',
      }))
    ) {
      return;
    }
    await run(() =>
      requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/yolo`, {
        method: enable ? 'POST' : 'DELETE',
        body: '{}',
      }),
    );
  };

  const grantWorkspace = async () => {
    if (!workspaceId) return;
    if (durableOAuth && connection.connectionId) {
      await run(() =>
        requestJson(`/api/connections/${encodeURIComponent(connection.connectionId!)}/workspaces`, {
          method: 'POST',
          body: JSON.stringify({ workspaceId, profileId: grantProfile }),
        }),
      );
    } else if (sessionId) {
      await run(() =>
        requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/workspace`, {
          method: 'POST',
          body: JSON.stringify({ workspaceId, timeoutMs: 60000 }),
        }),
      );
    }
  };

  const updateProfile = async (targetWsId: string, newProfile: string) => {
    if (!durableOAuth || !connection.connectionId) return;
    await run(() =>
      requestJson(`/api/connections/${encodeURIComponent(connection.connectionId!)}/workspaces`, {
        method: 'POST',
        body: JSON.stringify({ workspaceId: targetWsId, profileId: newProfile }),
      }),
    );
  };

  const revokeWorkspace = async (id: string) => {
    const wsName = workspaces.find((w) => w.id === id)?.name ?? id;
    if (
      !(await dialog.confirm({
        title: 'Remove workspace grant',
        message: `Remove access to "${wsName}" for this ${durableOAuth ? 'connection' : 'session'}?`,
        confirmLabel: 'Remove',
        confirmTone: 'danger',
      }))
    ) {
      return;
    }
    if (durableOAuth && connection.connectionId) {
      await run(() =>
        requestJson(
          `/api/connections/${encodeURIComponent(connection.connectionId!)}/workspaces/${encodeURIComponent(id)}`,
          { method: 'DELETE' },
        ),
      );
    } else if (sessionId) {
      await run(() =>
        requestJson(
          `/api/sessions/${encodeURIComponent(sessionId)}/workspace/${encodeURIComponent(id)}`,
          { method: 'DELETE' },
        ),
      );
    }
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
          <ConnectionDetails connection={connection} durableOAuth={durableOAuth} />
          {durableOAuth && connection.connectionId ? (
            <ConnectionControlGrantsPanel
              connectionId={connection.connectionId}
              onChanged={onChanged}
            />
          ) : null}
          <div className="connection-workspaces">
            <h3>Workspaces</h3>
            {granted.length ? (
              <ul>
                {granted.map((id, index) => {
                  const grant = connection.workspaceGrants?.find((g) => g.workspaceId === id);
                  const profile = grant?.profileId ?? 'read-only';
                  const name = connection.workspaces?.[index] ?? id;
                  return (
                    <li key={id}>
                      <span>{name}</span>
                      {durableOAuth ? (
                        <Dropdown
                          ariaLabel={`Profile for ${name}`}
                          value={profile}
                          onChange={(val) => void updateProfile(id, val)}
                          options={PROFILE_OPTIONS}
                        />
                      ) : null}
                      {canManageWorkspaces ? (
                        <button
                          type="button"
                          className="danger-button"
                          aria-label="Remove"
                          title="Remove"
                          data-surface-id="connections:revoke-workspace-grant"
                          onClick={() => void revokeWorkspace(id)}
                        >
                          [x]
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="muted">No workspace granted to this connection.</p>
            )}
            {canManageWorkspaces && grantOptions.length ? (
              <div className="connection-grant">
                <Dropdown
                  ariaLabel="Grant workspace"
                  value={workspaceId}
                  onChange={setWorkspaceId}
                  options={grantOptions}
                />
                {durableOAuth ? (
                  <Dropdown
                    ariaLabel="Grant profile"
                    value={grantProfile}
                    onChange={setGrantProfile}
                    options={PROFILE_OPTIONS}
                  />
                ) : null}
                <button type="button" onClick={() => void grantWorkspace()}>
                  Grant workspace
                </button>
              </div>
            ) : null}
          </div>
          {connection.recentOrigins && connection.recentOrigins.length ? (
            <div className="connection-origins">
              <h3>Recent runner origins</h3>
              <ul>
                {connection.recentOrigins.map((origin) => (
                  <li key={origin.remoteIp}>
                    <span>{origin.remoteIp}</span>
                    <span className="muted">{dateTime(origin.lastSeenAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {error ? <p className="warning">{error}</p> : null}
          <div className="actions">
            {sessionId ? (
              <button
                type="button"
                data-surface-id="connections:yolo"
                onClick={() => void toggleYolo()}
              >
                {connection.yolo ? 'Disable YOLO' : 'Enable YOLO'}
              </button>
            ) : null}
            <button
              type="button"
              className="danger-button"
              data-surface-id={
                durableOAuth ? 'connections:revoke-connection' : 'connections:revoke-session'
              }
              onClick={() => void revoke()}
            >
              {durableOAuth ? 'Revoke connection' : 'Revoke session'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
