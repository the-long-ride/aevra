import type { WorkspaceSummary } from '@aevra/admin-contracts';
import { useEffect, useState } from 'react';
import { useDialog } from '../../components/Dialog';
import { Dropdown } from '../../components/Dropdown';
import { requestJson } from '../../services/api-client';
import type { ActiveConnection } from './ConnectionDetailModal';

const PROFILE_OPTIONS = [
  { value: 'read-only', label: 'Read Only' },
  { value: 'coding-session', label: 'Coding Session' },
  { value: 'developer', label: 'Developer' },
  { value: 'full-workspace', label: 'Full Workspace' },
];

export function ConnectionWorkspaces({
  connection,
  workspaces,
  durableOAuth,
  sessionId,
  run,
}: {
  connection: ActiveConnection;
  workspaces: WorkspaceSummary[];
  durableOAuth: boolean;
  sessionId: string | undefined;
  run(action: () => Promise<unknown>): Promise<void>;
}) {
  const dialog = useDialog();
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? '');
  const [grantProfile, setGrantProfile] = useState('read-only');

  useEffect(() => {
    setWorkspaceId(workspaces[0]?.id ?? '');
    setGrantProfile('read-only');
  }, [connection, workspaces]);

  const connectionId = durableOAuth ? connection.connectionId : undefined;
  const canManage = Boolean(sessionId || connectionId);
  const granted = connection.workspaceIds ?? [];
  const grantOptions = workspaces
    .filter((workspace) => !granted.includes(workspace.id))
    .map((workspace) => ({ value: workspace.id, label: workspace.name }));

  const grantWorkspace = async () => {
    if (!workspaceId) return;
    if (connectionId) {
      await run(() =>
        requestJson(`/api/connections/${encodeURIComponent(connectionId)}/workspaces`, {
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
    if (!connectionId) return;
    await run(() =>
      requestJson(`/api/connections/${encodeURIComponent(connectionId)}/workspaces`, {
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
    if (connectionId) {
      await run(() =>
        requestJson(
          `/api/connections/${encodeURIComponent(connectionId)}/workspaces/${encodeURIComponent(id)}`,
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
    <section className="connection-workspaces connection-section" aria-label="Workspaces">
      <h3 className="connection-section-title">Workspaces</h3>
      {granted.length ? (
        <ul>
          {granted.map((id, index) => {
            const grant = connection.workspaceGrants?.find((g) => g.workspaceId === id);
            const profile = grant?.profileId ?? 'read-only';
            const name = connection.workspaces?.[index] ?? id;
            return (
              <li key={id}>
                <span className="connection-workspace-name">{name}</span>
                {durableOAuth ? (
                  <Dropdown
                    ariaLabel={`Profile for ${name}`}
                    value={profile}
                    onChange={(val) => void updateProfile(id, val)}
                    options={PROFILE_OPTIONS}
                  />
                ) : null}
                {canManage ? (
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
      {canManage && grantOptions.length ? (
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
    </section>
  );
}
