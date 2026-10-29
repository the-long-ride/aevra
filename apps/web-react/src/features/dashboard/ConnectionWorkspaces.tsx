import type { WorkspaceSummary } from '@aevra/admin-contracts';
import { useEffect, useState } from 'react';
import { useDialog } from '../../components/Dialog';
import { Dropdown } from '../../components/Dropdown';
import { useToast } from '../../components/Toast';
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
  const { toast, success } = useToast();
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? '');
  const [grantProfile, setGrantProfile] = useState('read-only');

  useEffect(() => {
    setWorkspaceId(workspaces[0]?.id ?? '');
    setGrantProfile('read-only');
  }, [connection, workspaces]);

  const connectionId = durableOAuth ? connection.connectionId : undefined;
  const connectorId =
    connection.connectorId ??
    (connection.authType === 'Bearer connector'
      ? connection.id
      : connection.actor?.startsWith('connector:')
        ? connection.id
        : undefined);
  const canManage = Boolean(sessionId || connectionId || connectorId);
  const canConfigProfile = Boolean(durableOAuth || connectorId);
  const granted = connection.workspaceIds ?? [];
  const grantOptions = workspaces
    .filter((workspace) => !granted.includes(workspace.id))
    .map((workspace) => ({ value: workspace.id, label: workspace.name }));

  useEffect(() => {
    setWorkspaceId(grantOptions[0]?.value ?? workspaces[0]?.id ?? '');
    setGrantProfile('read-only');
  }, [connection, workspaces]);

  const grantWorkspace = async () => {
    if (!workspaceId) return;
    if (connectorId) {
      await run(async () => {
        await requestJson(`/api/connectors/${encodeURIComponent(connectorId)}/workspaces`, {
          method: 'POST',
          body: JSON.stringify({ workspaceId, profileId: grantProfile }),
        });
        success('Workspace access granted.');
      });
    } else if (connectionId) {
      await run(async () => {
        await requestJson(`/api/connections/${encodeURIComponent(connectionId)}/workspaces`, {
          method: 'POST',
          body: JSON.stringify({ workspaceId, profileId: grantProfile }),
        });
        success('Workspace access granted.');
      });
    } else if (sessionId) {
      await run(async () => {
        await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/workspace`, {
          method: 'POST',
          body: JSON.stringify({ workspaceId, timeoutMs: 60000 }),
        });
        success('Workspace access granted.');
      });
    }
  };

  const updateProfile = async (targetWsId: string, newProfile: string) => {
    if (connectorId) {
      await run(async () => {
        await requestJson(`/api/connectors/${encodeURIComponent(connectorId)}/workspaces`, {
          method: 'POST',
          body: JSON.stringify({ workspaceId: targetWsId, profileId: newProfile }),
        });
        success('Workspace profile updated.');
      });
    } else if (connectionId) {
      await run(async () => {
        await requestJson(`/api/connections/${encodeURIComponent(connectionId)}/workspaces`, {
          method: 'POST',
          body: JSON.stringify({ workspaceId: targetWsId, profileId: newProfile }),
        });
        success('Workspace profile updated.');
      });
    }
  };

  const revokeWorkspace = async (id: string) => {
    const wsName = workspaces.find((w) => w.id === id)?.name ?? id;
    const noun = connectorId ? 'connector' : durableOAuth ? 'connection' : 'session';
    if (
      !(await dialog.confirm({
        title: 'Remove workspace grant',
        message: `Remove access to "${wsName}" for this ${noun}?`,
        confirmLabel: 'Remove',
        confirmTone: 'danger',
      }))
    ) {
      return;
    }
    if (connectorId) {
      await run(async () => {
        await requestJson(
          `/api/connectors/${encodeURIComponent(connectorId)}/workspaces/${encodeURIComponent(id)}`,
          { method: 'DELETE' },
        );
        success('Workspace access revoked.');
      });
    } else if (connectionId) {
      await run(async () => {
        await requestJson(
          `/api/connections/${encodeURIComponent(connectionId)}/workspaces/${encodeURIComponent(id)}`,
          { method: 'DELETE' },
        );
        success('Workspace access revoked.');
      });
    } else if (sessionId) {
      await run(async () => {
        await requestJson(
          `/api/sessions/${encodeURIComponent(sessionId)}/workspace/${encodeURIComponent(id)}`,
          { method: 'DELETE' },
        );
        success('Workspace access revoked.');
      });
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
            const wsObj = workspaces.find((w) => w.id === id);
            const name = wsObj?.name ?? connection.workspaces?.[index] ?? id;
            return (
              <li key={id}>
                <span className="connection-workspace-name">{name}</span>
                {canConfigProfile ? (
                  <Dropdown
                    className="connection-profile-dropdown"
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
          {canConfigProfile ? (
            <Dropdown
              className="connection-profile-dropdown"
              ariaLabel="Grant profile"
              value={grantProfile}
              onChange={setGrantProfile}
              options={PROFILE_OPTIONS}
            />
          ) : null}
          <button
            type="button"
            title="Grant workspace"
            data-surface-id="connections:grant-workspace"
            onClick={() => void grantWorkspace()}
          >
            [+]
          </button>
        </div>
      ) : null}
      {toast}
    </section>
  );
}
