import type { WorkspaceSummary } from '@aevra/admin-contracts';
import { useEffect, useState } from 'react';
import { useDialog } from '../../components/Dialog';
import { useModalLayer } from '../../components/modal-layer';
import { useToast } from '../../components/Toast';
import { requestJson } from '../../services/api-client';
import { fetchConnectorNotes } from '../../services/connector-notes-service';
import { ConnectionControlGrantsPanel } from './ConnectionControlGrants';
import {
  ConnectionDetailTabs,
  ConnectionTabPanel,
  type ConnectionTab,
} from './ConnectionDetailTabs';
import { ConnectionDetails, dateTime } from './ConnectionDetails';
import { ConnectionNotesPanel } from './ConnectionNotesPanel';
import { ConnectionToolSurface } from './ConnectionToolSurface';
import { ConnectionWorkspaces } from './ConnectionWorkspaces';

export interface ActiveConnection {
  id?: string;
  connectorId?: string;
  connectionId?: string;
  sessionId?: string;
  clientId?: string;
  clientIds?: string[];
  sessionCount?: number;
  client?: string;
  name?: string;
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

function useConnectionTab(identity: string | undefined) {
  const [state, setState] = useState<{ identity?: string; tab: ConnectionTab }>({
    identity,
    tab: 'details',
  });
  // A different connection opens on Details; refreshes of the same one keep the tab.
  if (state.identity !== identity) {
    const next = { identity, tab: 'details' as const };
    setState(next);
    return [next.tab, (tab: ConnectionTab) => setState({ identity, tab })] as const;
  }
  return [state.tab, (tab: ConnectionTab) => setState({ identity, tab })] as const;
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
  const { ref: layerRef } = useModalLayer();
  const { toast, error, success } = useToast();
  const [tab, setTab] = useConnectionTab(
    connection ? (connection.connectionId ?? connection.id) : undefined,
  );

  // Known before the Notes tab is opened, so its label can show the count.
  const noteActor = connection?.actor;
  const [noteCount, setNoteCount] = useState(0);
  useEffect(() => {
    setNoteCount(0);
    if (!noteActor) return;
    let live = true;
    fetchConnectorNotes(noteActor)
      .then((loaded) => {
        if (live) setNoteCount(loaded.notes.length);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [noteActor]);

  if (!connection?.id) return null;

  const isConnector = connection.authType === 'Bearer connector' || Boolean(connection.connectorId);
  const connectorId =
    connection.connectorId ??
    (isConnector
      ? connection.id
      : connection.actor?.startsWith('connector:')
        ? connection.id
        : undefined);
  const durableOAuth = connection.authType === 'OAuth' && Boolean(connection.connectionId);
  const isOAuthClient =
    connection.authType === 'OAuth' &&
    !durableOAuth &&
    Boolean(connection.clientId || connection.clientIds?.length);
  const sessionId =
    connection.sessionId ??
    (durableOAuth || isConnector || isOAuthClient ? undefined : connection.id);
  const tabs: ConnectionTab[] = connection.actor ? ['details', 'notes'] : ['details'];
  const activeTab: ConnectionTab = tabs.includes(tab) ? tab : 'details';

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await onChanged();
    } catch (cause) {
      error(cause);
    }
  };

  const revoke = async () => {
    const target = durableOAuth
      ? connection.connectionId!
      : connectorId
        ? connectorId
        : isOAuthClient
          ? (connection.clientId ?? connection.id!)
          : sessionId!;
    const noun = durableOAuth
      ? 'connection'
      : isConnector
        ? 'connector'
        : isOAuthClient
          ? 'client'
          : 'session';
    if (
      !(await dialog.confirm({
        title: isOAuthClient ? 'Remove client' : `Revoke ${noun}`,
        message: durableOAuth
          ? `Revoke ${connection.client ?? target} OAuth credentials and prevent silent resume?`
          : isConnector
            ? `Revoke connector ${connection.client ?? connection.name ?? target}?`
            : isOAuthClient
              ? `Remove ${connection.client ?? connection.name ?? target} OAuth client registration?`
              : `Disconnect ${connection.client ?? target}?`,
        confirmLabel: durableOAuth
          ? 'Revoke connection'
          : isOAuthClient
            ? 'Remove client'
            : 'Revoke',
        confirmTone: 'danger',
      }))
    ) {
      return;
    }
    await run(async () => {
      if (durableOAuth) {
        await requestJson(`/api/connections/${encodeURIComponent(target)}/revoke`, {
          method: 'POST',
          body: '{}',
        });
        success('Connection revoked.');
      } else if (connectorId) {
        await requestJson(`/api/connectors/${encodeURIComponent(connectorId)}`, {
          method: 'DELETE',
        });
        if (connection.sessionId) {
          await requestJson(`/api/sessions/${encodeURIComponent(connection.sessionId)}/revoke`, {
            method: 'POST',
            body: '{}',
          }).catch(() => undefined);
        }
        success('Connector revoked.');
      } else if (isOAuthClient) {
        const clientIds = connection.clientIds?.length
          ? connection.clientIds
          : [connection.clientId ?? target];
        for (const cId of clientIds) {
          await requestJson(`/api/oauth/clients/${encodeURIComponent(cId)}`, {
            method: 'DELETE',
          });
        }
        success('OAuth client removed.');
      } else {
        await requestJson(`/api/sessions/${encodeURIComponent(target)}/revoke`, {
          method: 'POST',
          body: '{}',
        });
        success('Session revoked.');
      }
    });
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
    await run(async () => {
      await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/yolo`, {
        method: enable ? 'POST' : 'DELETE',
        body: '{}',
      });
      success(enable ? 'YOLO mode enabled.' : 'YOLO mode disabled.');
    });
  };

  const details = (
    <div className="connection-detail">
      <section className="connection-section" aria-label="Summary">
        <h3 className="connection-section-title">Summary</h3>
        <ConnectionDetails connection={connection} durableOAuth={durableOAuth} />
      </section>
      {connection.actor ? <ConnectionToolSurface actor={connection.actor} /> : null}
      <ConnectionWorkspaces
        connection={connection}
        workspaces={workspaces}
        durableOAuth={durableOAuth}
        sessionId={sessionId}
        run={run}
      />
      {durableOAuth && connection.connectionId ? (
        <ConnectionControlGrantsPanel
          connectionId={connection.connectionId}
          onChanged={onChanged}
        />
      ) : null}
      {connection.recentOrigins && connection.recentOrigins.length ? (
        <section
          className="connection-origins connection-section"
          aria-label="Recent runner origins"
        >
          <h3 className="connection-section-title">Recent runner origins</h3>
          <ul>
            {connection.recentOrigins.map((origin) => (
              <li key={origin.remoteIp}>
                <span>{origin.remoteIp}</span>
                <span className="muted">{dateTime(origin.lastSeenAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );

  return (
    <div ref={layerRef} className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal connection-modal"
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
        {tabs.length > 1 ? (
          <ConnectionDetailTabs
            tabs={tabs}
            selected={activeTab}
            counts={{ notes: noteCount }}
            onSelect={setTab}
          />
        ) : null}
        <div className="modal-body connection-modal-body">
          {tabs.length > 1 ? (
            <ConnectionTabPanel tab={activeTab}>
              {activeTab === 'notes' && connection.actor ? (
                <ConnectionNotesPanel actor={connection.actor} onCountChange={setNoteCount} />
              ) : (
                details
              )}
            </ConnectionTabPanel>
          ) : (
            details
          )}
          {toast}
        </div>
        <footer className="modal-foot connection-modal-foot">
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
              durableOAuth
                ? 'connections:revoke-connection'
                : isOAuthClient
                  ? 'connections:revoke-client'
                  : 'connections:revoke-session'
            }
            onClick={() => void revoke()}
          >
            {durableOAuth
              ? 'Revoke connection'
              : isOAuthClient
                ? 'Remove client'
                : 'Revoke session'}
          </button>
        </footer>
      </section>
    </div>
  );
}
