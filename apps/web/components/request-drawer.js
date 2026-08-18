import { requestJson } from '../core/api.js';
import { escapeHtml } from '../core/dom.js';
import { localDateTime } from '../core/time.js';
import { approvalActions } from './request-actions.js';
import { mountDataTable } from './data-table.js';
import {
  announceNewRequests,
  notificationButtonLabel,
  requestNotificationPermission,
} from './request-notifications.js';
import { toast } from './toast.js';

let drawer;
let timer;

function approvalTitle(item) {
  return item.presentation?.title ??
    (item.operation?.family === 'workspace:select'
      ? 'Workspace access'
      : item.operation?.family === 'skills:read'
        ? 'Local skills access'
        : item.operation?.family ?? 'Operation approval');
}

function savedMatcher(item) {
  if (item.operation?.capability !== 'commands.run') return '';
  return String(
    item.payload?.permissionMatcher ??
      item.payload?.original?.permissionMatcher ??
      item.operation?.family ??
      '',
  );
}

function operationActions(item) {
  const admission =
    item.operation?.family === 'workspace:select' ||
    item.operation?.family === 'skills:read';
  if (admission) {
    return `<button type="button" data-request-deny="${escapeHtml(item.id)}">Deny</button>
      <button type="button" class="primary" data-request-approve="${escapeHtml(item.id)}" data-scope="once">Allow</button>`;
  }
  const command = item.operation?.capability === 'commands.run';
  return approvalActions({ risk: item.risk, command })
    .map((action) => {
      if (action.scope === null) {
        return `<button type="button" data-request-deny="${escapeHtml(item.id)}">${escapeHtml(action.label)}</button>`;
      }
      return `<button type="button" ${action.scope === 'once' ? 'class="primary"' : ''} data-request-approve="${escapeHtml(item.id)}" data-scope="${action.scope}">${escapeHtml(action.label)}</button>`;
    })
    .join('');
}

function operationCard(item, workspaceNames) {
  const presentation = item.presentation ?? {};
  const target =
    presentation.target ??
    (item.operation?.family === 'skills:read'
      ? 'User + workspace skills'
      : workspaceNames.get(item.workspaceId) ?? item.workspaceId ?? '');
  const preview = presentation.preview
    ? `<code class="request-preview">${escapeHtml(presentation.preview)}</code>`
    : '';
  const matcher = savedMatcher(item);
  const matcherMarkup = matcher
    ? `<span class="request-saved-matcher"><strong>Saved matcher</strong><code>${escapeHtml(matcher)}</code></span>`
    : '';
  return `<article class="request-card" data-request-id="${escapeHtml(item.id)}">
    <div class="request-card-head">
      <div><b>${escapeHtml(approvalTitle(item))}</b><span>${escapeHtml(item.actor)}</span></div>
      <span class="risk ${String(item.risk).toLowerCase()}">${escapeHtml(item.risk)}</span>
    </div>
    <div class="request-detail">
      <b>${escapeHtml(presentation.action ?? item.operation?.family ?? 'Operation')}</b>
      <span>${escapeHtml(target)}</span>
      ${preview}${matcherMarkup}
    </div>
    <small>Expires ${escapeHtml(localDateTime(item.expiresAt))}</small>
    <div class="request-actions">${operationActions(item)}</div>
  </article>`;
}

function oauthCard(item) {
  return `<article class="request-card">
    <div class="request-card-head">
      <div><b>OAuth connection</b><span>${escapeHtml(item.clientName ?? item.clientId)}</span></div>
      <span class="risk medium">MEDIUM</span>
    </div>
    <p>${escapeHtml(item.remoteIp ?? 'Remote client')} · code <code>${escapeHtml(item.pairingCode)}</code></p>
    <small>${escapeHtml((item.requestedScopes ?? item.scopes ?? []).join(', ') || 'mcp')}</small>
    <div class="request-actions">
      <button type="button" data-request-oauth-deny="${escapeHtml(item.id)}">Deny</button>
      <button type="button" class="primary" data-request-oauth-approve="${escapeHtml(item.id)}">Allow</button>
    </div>
  </article>`;
}

function ensureDrawer() {
  if (drawer?.isConnected) return drawer;
  drawer = document.createElement('div');
  drawer.id = 'request-drawer';
  drawer.className = 'request-drawer';
  drawer.innerHTML = `<div class="request-drawer-backdrop" data-close-requests></div>
    <aside>
      <header>
        <div><h2>Requests</h2><p>Local approvals and connection requests</p></div>
        <button type="button" id="enable-browser-notifications"></button>
        <button type="button" data-close-requests aria-label="Close">×</button>
      </header>
      <div class="request-tabs">
        <button type="button" class="active" data-request-tab="pending">Pending <span id="request-pending-count">0</span></button>
        <button type="button" data-request-tab="history">History</button>
      </div>
      <div class="request-panel" data-request-panel="pending"></div>
      <div class="request-panel" data-request-panel="history" hidden><div id="request-history-table"></div></div>
    </aside>`;
  document.body.append(drawer);
  drawer.addEventListener('click', handleClick);
  const notifications = drawer.querySelector('#enable-browser-notifications');
  notifications.textContent = notificationButtonLabel();
  notifications.addEventListener('click', async () => {
    await requestNotificationPermission();
    notifications.textContent = notificationButtonLabel();
  });
  return drawer;
}

async function handleClick(event) {
  if (event.target.closest('[data-close-requests]')) {
    closeRequestDrawer();
    return;
  }
  const tab = event.target.closest('[data-request-tab]')?.dataset.requestTab;
  if (tab) {
    for (const button of drawer.querySelectorAll('[data-request-tab]')) {
      button.classList.toggle('active', button.dataset.requestTab === tab);
    }
    for (const panel of drawer.querySelectorAll('[data-request-panel]')) {
      panel.hidden = panel.dataset.requestPanel !== tab;
    }
    return;
  }
  const oauthApprove = event.target.closest('[data-request-oauth-approve]')?.dataset.requestOauthApprove;
  const oauthDeny = event.target.closest('[data-request-oauth-deny]')?.dataset.requestOauthDeny;
  const approve = event.target.closest('[data-request-approve]');
  const deny = event.target.closest('[data-request-deny]');
  try {
    if (oauthApprove) {
      await requestJson(`/api/oauth/requests/${oauthApprove}/approve`, { method: 'POST', body: '{}' });
    }
    if (oauthDeny) {
      await requestJson(`/api/oauth/requests/${oauthDeny}/deny`, { method: 'POST', body: '{}' });
    }
    if (approve) {
      await requestJson(`/api/approvals/${approve.dataset.requestApprove}/approve`, {
        method: 'POST',
        body: JSON.stringify({ scope: approve.dataset.scope ?? 'once' }),
      });
    }
    if (deny) {
      await requestJson(`/api/approvals/${deny.dataset.requestDeny}/deny`, { method: 'POST', body: '{}' });
    }
    if (oauthApprove || oauthDeny || approve || deny) {
      toast('Request updated', 'success');
      await refreshRequestDrawer();
    }
  } catch (error) {
    toast(error.message, 'error');
  }
}

export async function refreshRequestDrawer({ force = false } = {}) {
  const node = ensureDrawer();
  if (!force && !node.classList.contains('open')) return;
  const [items, oauth, workspaces] = await Promise.all([
    requestJson('/api/approvals'),
    requestJson('/api/oauth/requests'),
    requestJson('/api/workspaces'),
  ]);
  announceNewRequests(items, oauth);
  const workspaceNames = new Map(workspaces.map((item) => [item.id, item.name]));
  const pending = items.filter((item) => item.state === 'PENDING');
  node.querySelector('#request-pending-count').textContent = String(pending.length + oauth.length);
  node.querySelector('[data-request-panel="pending"]').innerHTML = [
    ...oauth.map(oauthCard),
    ...pending.map((item) => operationCard(item, workspaceNames)),
  ].join('') || '<div class="empty-panel"><b>No pending requests</b><p>Incoming approvals will appear here.</p></div>';

  const history = items.filter((item) => item.state !== 'PENDING');
  mountDataTable(node.querySelector('#request-history-table'), {
    id: 'request-history',
    rows: history,
    pageSize: 10,
    filters: [
      { key: 'state', label: 'Status' },
      { key: 'risk', label: 'Risk' },
    ],
    columns: [
      { key: 'type', label: 'Type', value: approvalTitle, render: approvalTitle },
      { key: 'actor', label: 'Actor' },
      { key: 'state', label: 'Status' },
      { key: 'risk', label: 'Risk' },
      {
        key: 'updatedAt',
        label: 'Time',
        render: (item) => escapeHtml(localDateTime(item.updatedAt ?? item.expiresAt)),
        priority: 'low',
      },
    ],
    emptyText: 'No approval history.',
  });
}

export function openRequestDrawer() {
  ensureDrawer().classList.add('open');
  void refreshRequestDrawer({ force: true });
  clearInterval(timer);
  timer = setInterval(() => void refreshRequestDrawer(), 2200);
}

export function closeRequestDrawer() {
  drawer?.classList.remove('open');
  clearInterval(timer);
  timer = undefined;
}

export function startRequestWatch() {
  ensureDrawer();
  void refreshRequestDrawer({ force: true });
  return setInterval(() => void refreshRequestDrawer({ force: true }), 2200);
}
