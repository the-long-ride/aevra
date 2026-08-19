import type { ApprovalItem, ApprovalScope } from '@aevra/admin-contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { actionsForApproval } from './request-actions';
import { announceNewRequests } from './request-notifications';
import {
  approveRequest,
  decideOauth,
  denyRequest,
  enableYoloRequest,
  loadRequests,
  type RequestsData,
} from './requests-service';

function savedMatcher(item: ApprovalItem) {
  if (item.operation.capability !== 'commands.run') return '';
  const payload = item.payload ?? {};
  const original =
    typeof payload.original === 'object' && payload.original !== null
      ? (payload.original as Record<string, unknown>)
      : {};
  return String(
    payload.permissionMatcher ?? original.permissionMatcher ?? item.operation.family ?? '',
  );
}

function ApprovalCard({
  item,
  workspaceName,
  onChanged,
}: {
  item: ApprovalItem;
  workspaceName?: string;
  onChanged(): Promise<void>;
}) {
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
    const confirmed = window.confirm(
      'Enable YOLO for this connector session? Future operations in this session will skip capability and approval prompts until YOLO is disabled or the session ends.',
    );
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
            className="danger"
            data-surface-id="requests:yolo-session"
            title="Allow this connector session to skip future Aevra capability and approval prompts"
            onClick={() => void enableYolo()}
          >
            YOLO session
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
}: {
  open: boolean;
  onClose(): void;
  onPendingCountChange(count: number): void;
}) {
  const [data, setData] = useState<RequestsData | null>(null);
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [notifications, setNotifications] = useState(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );

  const refresh = useCallback(async () => {
    const next = await loadRequests();
    setData(next);
    announceNewRequests(next.approvals, next.oauth);
    onPendingCountChange(
      next.approvals.filter((item) => item.state === 'PENDING').length + next.oauth.length,
    );
  }, [onPendingCountChange]);

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

  const requestNotifications = async () => {
    if (typeof Notification === 'undefined') return;
    setNotifications(await Notification.requestPermission());
  };

  return (
    <div className={`request-drawer ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div className="request-drawer-backdrop" onClick={onClose} />
      <aside>
        <header>
          <div>
            <h2>Requests</h2>
            <p>Local approvals and connection requests</p>
          </div>
          <button
            type="button"
            id="enable-browser-notifications"
            disabled={notifications === 'granted' || notifications === 'denied'}
            onClick={() => void requestNotifications()}
          >
            {notifications === 'granted'
              ? 'Browser notifications enabled'
              : notifications === 'denied'
                ? 'Browser notifications blocked'
                : notifications === 'unsupported'
                  ? 'Browser notifications unavailable'
                  : 'Enable browser notifications'}
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
            Pending <span>{pending.length + (data?.oauth.length ?? 0)}</span>
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
              {pending.length === 0 && (data?.oauth.length ?? 0) === 0 ? (
                <div className="empty-panel">No pending requests</div>
              ) : null}
            </>
          ) : (
            <DataTable
              id="react-request-history"
              rows={history}
              pageSize={10}
              filters={[
                { key: 'state', label: 'Status' },
                { key: 'risk', label: 'Risk' },
              ]}
              columns={[
                { key: 'actor', label: 'Actor' },
                { key: 'state', label: 'Status' },
                { key: 'risk', label: 'Risk' },
                {
                  key: 'operation',
                  label: 'Operation',
                  value: (row) => row.operation.family,
                  render: (row) => row.operation.family,
                },
              ]}
              emptyText="No approval history."
              rowKey={(row) => row.id}
            />
          )}
        </div>
      </aside>
    </div>
  );
}
