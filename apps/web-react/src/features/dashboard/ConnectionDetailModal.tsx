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
  const { toast, error } = useToast();
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

  const durableOAuth = connection.authType === 'OAuth' && Boolean(connection.connectionId);
  const sessionId = connection.sessionId ?? (durableOAuth ? undefined : connection.id);
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
              durableOAuth ? 'connections:revoke-connection' : 'connections:revoke-session'
            }
            onClick={() => void revoke()}
          >
            {durableOAuth ? 'Revoke connection' : 'Revoke session'}
          </button>
        </footer>
      </section>
    </div>
  );
}
