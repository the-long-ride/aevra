import { requestJson } from '../core/api.js';
import { card, escapeHtml } from '../core/dom.js';
import { duration, localDateTime } from '../core/time.js';
import { mountDataTable } from '../components/data-table.js';
import { closeModal, openModal } from '../components/modal.js';
import {
  remoteAccessMarkup,
  wireRemoteAccess,
} from '../components/remote-access.js';
import { toast } from '../components/toast.js';
import { dashboardOrder } from './dashboard-order.js';

const openState = new Map();

function isOpen(id) {
  return openState.get(id) ?? true;
}

function collapsible(id, title, body, className = '') {
  return `<details class="dashboard-section ${escapeHtml(className)}" data-dashboard-section="${id}" ${isOpen(id) ? 'open' : ''}>
    <summary class="dashboard-section-summary"><span>${escapeHtml(title)}</span><span aria-hidden="true">⌄</span></summary>
    <div class="dashboard-section-body">${body}</div>
  </details>`;
}

function runtimeOverview(snapshot) {
  const rows = [
    ['Version', snapshot.status?.version ? `v${String(snapshot.status.version).replace(/^v/, '')}` : '—'],
    ['Uptime', duration(snapshot.uptimeSeconds)],
    ['Remote sessions', snapshot.stats.sessions],
    ['Workspace leases', snapshot.stats.workspaceLeases],
    ['Pending requests', snapshot.pending.total],
    ['Managed processes', snapshot.stats.processes],
    ['Open changes', snapshot.stats.openChanges],
    ['Tool calls', snapshot.stats.toolCalls],
    ['Avg tool latency', snapshot.stats.avgToolLatencyMs == null ? '—' : `${snapshot.stats.avgToolLatencyMs} ms`],
    ['Connectors', snapshot.stats.connectors],
  ];
  return `<div class="runtime-grid">${rows
    .map(
      ([label, value]) =>
        `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
    )
    .join('')}</div>`;
}

function onboardingMarkup(onboarding, cloudflare, workspaces) {
  const endpoint = cloudflare?.hostname
    ? `https://${cloudflare.hostname}/mcp`
    : 'Configure Remote Access first';
  const providers = [
    ['ChatGPT', 'Create a custom MCP app and use OAuth.'],
    ['Claude', 'Add a remote MCP server and authenticate with OAuth.'],
    ['Gemini', 'Add the MCP endpoint and complete OAuth.'],
  ];
  return `<div class="onboarding-body">
    <section class="onboarding-block wide" data-onboarding-section="remote-access">
      <div class="section-heading"><span>Remote Access</span><strong>${cloudflare?.hostname ? 'Configured' : 'Setup needed'}</strong></div>
      ${remoteAccessMarkup(cloudflare, 'dashboard')}
    </section>
    <section class="onboarding-block wide" data-onboarding-section="connect-ai">
      <div class="section-heading"><span>Connect an AI</span><strong>Example guide</strong></div>
      <p class="section-note">Examples only; provider screens can change.</p>
      <div class="endpoint"><span>MCP endpoint</span><code>${escapeHtml(endpoint)}</code></div>
      <div class="client-grid">${providers
        .map(
          ([name, description]) =>
            `<article class="client-example"><h3>${name}</h3><p>${description}</p><p>Authentication: <b>OAuth</b></p><button type="button" data-guide-slug="connect-${name.toLowerCase()}">Open guide</button></article>`,
        )
        .join('')}</div>
    </section>
    <section class="onboarding-block" data-onboarding-section="workspace">
      <div class="section-heading"><span>Workspace</span><strong>${workspaces.length ? `${workspaces.length} registered` : 'Register one'}</strong></div>
      ${
        workspaces.length
          ? '<p>Your local workspace is ready. Manage details from Workspaces.</p><button type="button" data-nav-page="workspaces">Open Workspaces</button>'
          : '<form id="onboard-workspace" class="stack-form"><input name="name" placeholder="Workspace name" required><input name="hostRoot" placeholder="Absolute path to your project" required><button class="primary">Register workspace</button></form>'
      }
    </section>
    <section class="onboarding-block" data-onboarding-section="try-aevra">
      <div class="section-heading"><span>Try Aevra</span><strong>Start read-only</strong></div>
      <p>Select a workspace from chat, approve access locally, then start with status, skills and file reads.</p>
      <div class="actions"><button type="button" data-open-requests>Requests</button><button type="button" data-nav-page="workspaces">Workspaces</button></div>
    </section>
    <section class="onboarding-block wide onboarding-finish" data-onboarding-section="finish-onboarding">
      <div><b>${onboarding.completed ? 'Onboarding completed' : 'Finish onboarding when setup is ready'}</b></div>
      <button type="button" class="primary" id="finish-onboarding" ${onboarding.completed ? 'disabled' : ''}>${onboarding.completed ? 'Completed' : 'Finish onboarding'}</button>
    </section>
  </div>`;
}

function recentActivity(snapshot) {
  const rows = [
    ['Requests', snapshot.pending.total, 'awaiting local action'],
    ['Sessions', snapshot.stats.sessions, 'remote MCP sessions'],
    ['Processes', snapshot.stats.processes, 'managed locally'],
    ['Changes', snapshot.stats.openChanges, 'open change sets'],
  ];
  return `<div class="recent-grid">${rows
    .map(
      ([label, value, detail]) =>
        `<div><span>${label}</span><strong>${value}</strong><small>${detail}</small></div>`,
    )
    .join('')}</div>`;
}

function connectorModal(reload) {
  openModal(
    'Create Bearer connector',
    `<p class="muted">OAuth is preferred. Use a fixed Bearer token only when the client requires it.</p>
     <form id="connector-form" class="stack-form"><input name="name" placeholder="Connector name" required><button class="primary">Create token</button></form><div id="connector-secret"></div>`,
    {
      onReady(body) {
        body.querySelector('#connector-form').addEventListener('submit', async (event) => {
          event.preventDefault();
          const name = String(new FormData(event.target).get('name') ?? '').trim();
          if (!name) return;
          const created = await requestJson('/api/connectors', {
            method: 'POST',
            body: JSON.stringify({ name }),
          });
          body.querySelector('#connector-secret').innerHTML = `<div class="secret-result"><b>Copy this token now. It is shown once.</b><code>${escapeHtml(created.token)}</code><button type="button" id="copy-token">Copy token</button></div>`;
          body.querySelector('#copy-token').addEventListener('click', async () => {
            await navigator.clipboard.writeText(created.token);
            toast('Token copied', 'success');
          });
          await reload();
        });
      },
    },
  );
}

function wireTables(container, snapshot, reload) {
  mountDataTable(container.querySelector('#active-connections-table'), {
    id: 'dashboard-active-connections',
    rows: snapshot.activeConnections ?? [],
    pageSize: 10,
    defaultSort: { key: 'lastActivityAt', dir: 'desc' },
    filters: [
      { key: 'authType', label: 'Auth' },
      { key: 'status', label: 'Status' },
    ],
    columns: [
      { key: 'client', label: 'Client' },
      { key: 'authType', label: 'Auth' },
      { key: 'workspace', label: 'Workspace' },
      { key: 'capabilities', label: 'Capabilities', value: (row) => (row.capabilities ?? []).join(', '), priority: 'low' },
      { key: 'lastActivityAt', label: 'Last activity', render: (row) => escapeHtml(localDateTime(row.lastActivityAt)) },
    ],
    emptyText: 'No active remote connections.',
  });
  mountDataTable(container.querySelector('#tool-activity-table'), {
    id: 'dashboard-tools',
    rows: snapshot.metrics ?? [],
    searchPlaceholder: 'Search tools…',
    defaultSort: { key: 'calls', dir: 'desc' },
    columns: [
      { key: 'tool', label: 'Tool' },
      { key: 'calls', label: 'Calls' },
      { key: 'avgMs', label: 'Avg latency', render: (row) => `${Number(row.avgMs ?? 0)} ms` },
      { key: 'totalMs', label: 'Total time', render: (row) => `${Number(row.totalMs ?? 0)} ms`, priority: 'low' },
    ],
    emptyText: 'No tool calls recorded in this runtime.',
  });
  mountDataTable(container.querySelector('#connections-table'), {
    id: 'dashboard-connectors',
    rows: snapshot.connectors ?? [],
    defaultSort: { key: 'lastUsedAt', dir: 'desc' },
    columns: [
      { key: 'name', label: 'Connector' },
      { key: 'createdAt', label: 'Created', render: (row) => escapeHtml(localDateTime(row.createdAt)), priority: 'low' },
      { key: 'lastUsedAt', label: 'Last used', render: (row) => escapeHtml(localDateTime(row.lastUsedAt)) },
      { key: 'actions', label: '', sortable: false, search: false, render: () => '<button type="button" data-table-action="revoke">Revoke</button>' },
    ],
    onAction: async (action, row) => {
      if (action !== 'revoke' || !confirm(`Revoke ${row.name}?`)) return;
      await requestJson(`/api/connectors/${row.id}`, { method: 'DELETE' });
      toast('Connector revoked', 'success');
      await reload();
    },
  });
}

export async function renderDashboardPage(container, context) {
  let stopped = false;
  let timer;
  const render = async () => {
    if (stopped) return;
    const [snapshot, onboarding, cloudflare, workspaces] = await Promise.all([
      requestJson('/api/dashboard/runtime'),
      requestJson('/api/onboarding'),
      requestJson('/api/cloudflare/status'),
      requestJson('/api/workspaces'),
    ]);
    if (stopped) return;
    const sections = {
      onboarding: collapsible('onboarding', 'Onboarding', onboardingMarkup(onboarding, cloudflare, workspaces)),
      'runtime-overview': collapsible('runtime-overview', 'Runtime overview', runtimeOverview(snapshot)),
      'active-connections': collapsible('active-connections', 'Active connections', '<div id="active-connections-table"></div>'),
      'tool-activity': collapsible('tool-activity', 'Tool activity', '<div id="tool-activity-table"></div>'),
      connections: collapsible('connections', 'Connections', '<div class="panel-toolbar"><p>OAuth is recommended. Static Bearer connectors remain available when needed.</p><button type="button" id="create-connector">New connector</button></div><div id="connections-table"></div>'),
      'recent-activity': collapsible('recent-activity', 'Recent activity', recentActivity(snapshot)),
    };
    container.innerHTML = `<section class="page-head"><div><h2>Dashboard</h2><p>Local gateway runtime, connections, requests, and onboarding.</p></div></section>${dashboardOrder(onboarding.completed).map((id) => sections[id]).join('')}`;
    for (const details of container.querySelectorAll('[data-dashboard-section]')) {
      details.addEventListener('toggle', () => openState.set(details.dataset.dashboardSection, details.open));
    }
    wireRemoteAccess(container, cloudflare, 'dashboard', render);
    wireTables(container, snapshot, render);
    container.querySelector('#create-connector')?.addEventListener('click', () => connectorModal(render));
    container.querySelector('#onboard-workspace')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      await requestJson('/api/workspaces', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
      toast('Workspace registered', 'success');
      await render();
    });
    container.querySelector('#finish-onboarding')?.addEventListener('click', async () => {
      await requestJson('/api/onboarding', { method: 'PATCH', body: JSON.stringify({ completed: true, completedSections: ['remote-access', 'connect-ai', 'workspace', 'try-aevra', 'explore'] }) });
      toast('Onboarding completed', 'success');
      await render();
    });
  };
  await render();
  timer = setInterval(() => void render(), 2000);
  return () => {
    stopped = true;
    clearInterval(timer);
    closeModal();
  };
}
