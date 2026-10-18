import type { ApprovalItem, ApprovalScope } from '@aevra/admin-contracts';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDialog } from '../../components/Dialog';
import { useModalLayer } from '../../components/modal-layer';
import { useToast } from '../../components/Toast';
import { ApprovalScopeHint } from './ApprovalScopeHint';
import { actionsForApproval, savedMatcher } from './request-actions';
import { RequestHistory } from './RequestHistory';
import { announceNewRequests } from './request-notifications';
import {
  approveRequest,
  decideOauth,
  denyRequest,
  decideDesktopAccessRequest,
  enableYoloRequest,
  loadDesktopAccessRequests,
  loadRequests,
  type DesktopAccessRequest,
  type RequestsData,
} from './requests-service';

const isWebView2 = (p: string) => p.split(/[\\/]/).pop()?.toLowerCase() === 'msedgewebview2.exe';

const NOTIFICATION_LABELS: Record<string, string> = {
  granted: 'Browser notifications enabled',
  denied: 'Browser notifications blocked',
  unsupported: 'Browser notifications unavailable',
};

function ApprovalCard({
  item,
  workspaceName,
  onChanged,
}: {
  item: ApprovalItem;
  workspaceName?: string;
  onChanged(): Promise<void>;
}) {
  const dialog = useDialog();
  const presentation = item.presentation ?? {
    title: item.operation.family,
    action: item.operation.family,
    target: workspaceName ?? item.workspaceId ?? '',
  };
  const matcher = savedMatcher(item);
  const yoloEligible =
    Boolean(item.sessionId) &&
    (item.actor.startsWith('connector:') || item.actor.startsWith('oauth:'));
  const perform = async (scope: ApprovalScope | null) => {
    if (scope) await approveRequest(item.id, scope);
    else await denyRequest(item.id);
    await onChanged();
  };
  const enableYolo = async () => {
    const confirmed = await dialog.confirm({
      title: 'Enable YOLO session?',
      message: 'YOLO enabled — immutable security approvals still require confirmation',
      confirmLabel: 'Enable YOLO',
      confirmTone: 'yolo',
    });
    if (!confirmed) return;
    await enableYoloRequest(item.id);
    await onChanged();
  };
  return (
    <article className="request-card" data-request-id={item.id}>
      <div className="request-card-head">
        <div>
          <b>{presentation.title}</b>
          <span>{item.actor}</span>
        </div>
        <span className={`risk ${item.risk.toLowerCase()}`}>{item.risk}</span>
      </div>
      <div className="request-detail">
        <b>{presentation.action}</b>
        <span>{presentation.target}</span>
        {presentation.preview ? (
          <code className="request-preview">{presentation.preview}</code>
        ) : null}
        {matcher ? (
          <span className="request-saved-matcher">
            <strong>Saved matcher</strong>
            <code>{matcher}</code>
          </span>
        ) : null}
      </div>
      <ApprovalScopeHint
        item={item}
        connectionHasMultipleSessions={presentation.connectionHasMultipleSessions}
      />
      <div className="request-actions">
        {actionsForApproval(item).map((action) => (
          <button
            key={action.id}
            type="button"
            className={action.scope === 'once' ? 'primary' : ''}
            data-surface-id={`requests:${action.id}`}
            onClick={() => void perform(action.scope)}
          >
            {action.label}
          </button>
        ))}
        {yoloEligible ? (
          <button
            type="button"
            className="yolo-action"
            data-surface-id="requests:yolo-session"
            title="Allow this connector session to skip future Aevra capability and approval prompts"
            onClick={() => void enableYolo()}
          >
            Enable YOLO
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function RequestDrawer({
  open,
  onClose,
  onPendingCountChange,
  onNewPending,
  onPendingSync,
  refreshRef,
}: {
  open: boolean;
  onClose(): void;
  onPendingCountChange(count: number): void;
  onNewPending?(data: RequestsData): void;
  onPendingSync?(data: RequestsData): void;
  refreshRef?: React.MutableRefObject<(() => Promise<void>) | null>;
}) {
  const [data, setData] = useState<RequestsData | null>(null);
  const [desktopAccessRequests, setDesktopAccessRequests] = useState<DesktopAccessRequest[]>([]);
  const [desktopAccessError, setDesktopAccessError] = useState('');
  const { toast, error } = useToast();
  const { ref: layerRef } = useModalLayer(open);
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [notifications, setNotifications] = useState(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );
  const prevPendingIds = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    const [next, desktopRequests] = await Promise.all([
      loadRequests(),
      loadDesktopAccessRequests()
        .then((requests) => ({ requests, error: '' }))
        .catch((cause: unknown) => ({
          requests: [],
          error: cause instanceof Error ? cause.message : String(cause),
        })),
    ]);
    const combined = { ...next, desktopAccess: desktopRequests.requests };
    setData(combined);
    setDesktopAccessRequests(desktopRequests.requests);
    setDesktopAccessError(desktopRequests.error);
    announceNewRequests(next.approvals, next.oauth);
    const pendingItems = next.approvals.filter((item) => item.state === 'PENDING');
    const pendingCount = pendingItems.length + next.oauth.length + desktopRequests.requests.length;
    onPendingCountChange(pendingCount);

    if (onNewPending) {
      const currentIds = new Set([
        ...pendingItems.map((item) => String(item.id)),
        ...next.oauth.map((item) => `oauth:${item.id}`),
        ...desktopRequests.requests.map((item) => `desktop-access:${item.id}`),
      ]);
      const actionablePromptIds = [
        ...pendingItems.map((item) => String(item.id)),
        ...next.oauth.map((item) => `oauth:${item.id}`),
      ];
      const hasNew = actionablePromptIds.some((id) => !prevPendingIds.current.has(id));
      if (hasNew && pendingCount > 0) {
        onNewPending(combined);
      }
      prevPendingIds.current = currentIds;
    }
    onPendingSync?.(combined);
  }, [onPendingCountChange, onNewPending, onPendingSync]);

  useEffect(() => {
    if (refreshRef) refreshRef.current = refresh;
    return () => {
      if (refreshRef) refreshRef.current = null;
    };
  }, [refresh, refreshRef]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2200);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const workspaceNames = useMemo(
    () => new Map(data?.workspaces.map((item) => [item.id, item.name]) ?? []),
    [data],
  );
  const pending = data?.approvals.filter((item) => item.state === 'PENDING') ?? [];
  const history = data?.approvals.filter((item) => item.state !== 'PENDING') ?? [];

  const decideDesktopAccess = async (
    item: DesktopAccessRequest,
    decision: 'deny' | 'session' | 'persistent',
  ) => {
    try {
      await decideDesktopAccessRequest(item.id, decision);
      await refresh();
    } catch (cause) {
      error(cause);
    }
  };

  const requestNotifications = async () => {
    if (typeof Notification === 'undefined') return;
    setNotifications(await Notification.requestPermission());
  };

  return (
    <>
      <div ref={layerRef} className={`request-drawer ${open ? 'open' : ''}`} aria-hidden={!open}>
        <div className="request-drawer-backdrop" onClick={onClose} />
        <aside>
          <header>
            <div>
              <h2>Requests</h2>
              <p>Local approvals, app access and connection requests</p>
            </div>
            <button
              type="button"
              id="enable-browser-notifications"
              disabled={notifications === 'granted' || notifications === 'denied'}
              onClick={() => void requestNotifications()}
            >
              {NOTIFICATION_LABELS[notifications] ?? 'Enable browser notifications'}
            </button>
            <button type="button" aria-label="Close" onClick={onClose}>
              ×
            </button>
          </header>
          <div className="request-tabs">
            <button
              type="button"
              className={tab === 'pending' ? 'active' : ''}
              onClick={() => setTab('pending')}
            >
              Pending{' '}
              <span>
                {pending.length + (data?.oauth.length ?? 0) + desktopAccessRequests.length}
              </span>
            </button>
            <button
              type="button"
              className={tab === 'history' ? 'active' : ''}
              onClick={() => setTab('history')}
            >
              History
            </button>
          </div>
          <div className="request-panel">
            {tab === 'pending' ? (
              <>
                {desktopAccessError ? (
                  <p role="alert" className="inline-result warning-text">
                    {desktopAccessError}
                  </p>
                ) : null}
                {desktopAccessRequests.map((item) => (
                  <article className="request-card" key={item.id} data-request-id={item.id}>
                    <div className="request-card-head">
                      <div>
                        <b>Desktop app access</b>
                        <span>{item.actor}</span>
                      </div>
                      <span className="risk high">HIGH</span>
                    </div>
                    <div className="request-detail">
                      <b>
                        {isWebView2(item.targetExecutablePath)
                          ? 'Verified host app'
                          : 'Application'}
                        : {item.hostExecutablePath}
                      </b>
                      {isWebView2(item.targetExecutablePath) ? (
                        <span>WebView2 process: {item.targetExecutablePath}</span>
                      ) : null}
                      <span>
                        Requested: {item.requestedDuration} · expires{' '}
                        {new Date(item.expiresAt).toLocaleTimeString()}
                      </span>
                      <span>
                        Allowing this app grants desktop input to windows Aevra verifies as
                        belonging to this executable. Desktop capability and action approvals still
                        apply.
                      </span>
                    </div>
                    <div className="request-actions">
                      <button type="button" onClick={() => void decideDesktopAccess(item, 'deny')}>
                        Deny
                      </button>
                      <button
                        type="button"
                        onClick={() => void decideDesktopAccess(item, 'session')}
                      >
                        Allow this session
                      </button>
                      <button
                        type="button"
                        className="primary"
                        onClick={() => void decideDesktopAccess(item, 'persistent')}
                      >
                        Persist for this app
                      </button>
                    </div>
                  </article>
                ))}
                {data?.oauth.map((item) => (
                  <article className="request-card" key={item.id}>
                    <div className="request-card-head">
                      <div>
                        <b>OAuth connection</b>
                        <span>{item.clientName ?? item.clientId}</span>
                      </div>
                      <span className="risk medium">MEDIUM</span>
                    </div>
                    <p>
                      {item.remoteIp ?? 'Remote client'} · code <code>{item.pairingCode}</code>
                    </p>
                    <div className="request-actions">
                      <button
                        type="button"
                        onClick={() => void decideOauth(item.id, false).then(refresh)}
                      >
                        Deny
                      </button>
                      <button
                        type="button"
                        className="primary"
                        onClick={() => void decideOauth(item.id, true).then(refresh)}
                      >
                        Allow
                      </button>
                    </div>
                  </article>
                ))}
                {pending.map((item) => (
                  <ApprovalCard
                    key={item.id}
                    item={item}
                    workspaceName={workspaceNames.get(item.workspaceId ?? '')}
                    onChanged={refresh}
                  />
                ))}
                {pending.length === 0 &&
                (data?.oauth.length ?? 0) === 0 &&
                desktopAccessRequests.length === 0 ? (
                  <div className="empty-panel">No pending requests</div>
                ) : null}
              </>
            ) : (
              <RequestHistory history={history} onCleared={refresh} />
            )}
          </div>
        </aside>
      </div>
      {toast}
    </>
  );
}
