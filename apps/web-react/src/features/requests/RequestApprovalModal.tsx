import type { ApprovalItem, OauthRequestItem } from '@aevra/admin-contracts';
import { useEffect, useRef, useState } from 'react';
import { useDialog } from '../../components/Dialog';
import { actionsForApproval } from './request-actions';
import {
  approveRequest,
  decideOauth,
  denyRequest,
  enableYoloRequest,
  type RequestsData,
} from './requests-service';

export interface RequestApprovalModalProps {
  data: RequestsData;
  onActioned(): Promise<void>;
  onDismiss(): void;
}

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

function ApprovalModalCard({
  item,
  workspaceName,
  onActioned,
}: {
  item: ApprovalItem;
  workspaceName?: string;
  onActioned(): Promise<void>;
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

  const perform = async (scope: import('@aevra/admin-contracts').ApprovalScope | null) => {
    if (scope) await approveRequest(item.id, scope);
    else await denyRequest(item.id);
    await onActioned();
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
    await onActioned();
  };

  return (
    <>
      <div className="approval-modal-head">
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
      <div className="request-actions approval-modal-actions">
        {actionsForApproval(item).map((action) => (
          <button
            key={action.id}
            type="button"
            className={action.scope === 'once' ? 'primary' : ''}
            data-surface-id={`approval-modal:${action.id}`}
            onClick={() => void perform(action.scope)}
          >
            {action.label}
          </button>
        ))}
        {yoloEligible ? (
          <button
            type="button"
            className="yolo-action"
            data-surface-id="approval-modal:yolo-session"
            title="Allow this connector session to skip future approval prompts"
            onClick={() => void enableYolo()}
          >
            Enable YOLO
          </button>
        ) : null}
      </div>
    </>
  );
}

function OauthModalCard({
  item,
  onActioned,
}: {
  item: OauthRequestItem;
  onActioned(): Promise<void>;
}) {
  return (
    <>
      <div className="approval-modal-head">
        <div>
          <b>OAuth connection</b>
          <span>{item.clientName ?? item.clientId}</span>
        </div>
        <span className="risk medium">MEDIUM</span>
      </div>
      <p className="approval-modal-detail">
        {item.remoteIp ?? 'Remote client'} · code <code>{item.pairingCode}</code>
      </p>
      <div className="request-actions approval-modal-actions">
        <button
          type="button"
          data-surface-id="approval-modal:oauth-deny"
          onClick={() => void decideOauth(item.id, false).then(onActioned)}
        >
          Deny
        </button>
        <button
          type="button"
          className="primary"
          data-surface-id="approval-modal:oauth-allow"
          onClick={() => void decideOauth(item.id, true).then(onActioned)}
        >
          Allow
        </button>
      </div>
    </>
  );
}

export function RequestApprovalModal({ data, onActioned, onDismiss }: RequestApprovalModalProps) {
  const pending = data.approvals.filter((item) => item.state === 'PENDING');
  const workspaceNames = new Map(data.workspaces.map((item) => [item.id, item.name]));

  // Show oauth first, then approvals
  const oauthItem = data.oauth[0];
  const approvalItem = pending[0];
  const remaining = data.oauth.length + pending.length;

  const [current, setCurrent] = useState<'oauth' | 'approval'>(() =>
    oauthItem ? 'oauth' : 'approval',
  );
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const dismissRef = useRef(onDismiss);

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  // Keep displayed card in sync when data changes (e.g. item resolved, next one shown)
  useEffect(() => {
    if (oauthItem && current === 'oauth') return;
    if (approvalItem && current === 'approval') return;
    if (oauthItem) setCurrent('oauth');
    else if (approvalItem) setCurrent('approval');
  }, [oauthItem, approvalItem, current]);

  useEffect(() => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (!focusable.length) return;

      const index = focusable.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) {
        event.preventDefault();
        focusable.at(-1)?.focus();
      } else if (!event.shiftKey && (index === -1 || index === focusable.length - 1)) {
        event.preventDefault();
        focusable[0]?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousFocus.current?.focus();
    };
  }, []);

  if (!oauthItem && !approvalItem) return null;

  const showItem = current === 'oauth' && oauthItem ? oauthItem : approvalItem;
  if (!showItem) return null;

  const isOauth = 'pairingCode' in showItem;

  return (
    <div
      className="modal-backdrop approval-modal-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onDismiss();
      }}
    >
      <article
        ref={dialogRef}
        className="approval-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Approval request"
        tabIndex={-1}
      >
        <div className="approval-modal-toolbar">
          <span className="approval-modal-label">
            Approval request{remaining > 1 ? ` · ${remaining} pending` : ''}
          </span>
          <button
            type="button"
            aria-label="Dismiss approval modal"
            data-surface-id="approval-modal:dismiss"
            onClick={onDismiss}
          >
            ×
          </button>
        </div>
        <div className="approval-modal-body">
          {isOauth ? (
            <OauthModalCard item={showItem as OauthRequestItem} onActioned={onActioned} />
          ) : (
            <ApprovalModalCard
              item={showItem as ApprovalItem}
              workspaceName={workspaceNames.get((showItem as ApprovalItem).workspaceId ?? '')}
              onActioned={onActioned}
            />
          )}
        </div>
      </article>
    </div>
  );
}
