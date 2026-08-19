import { requestJson } from '../core/api.js';
import { escapeHtml } from '../core/dom.js';
import { localDateTime } from '../core/time.js';
import { mountDataTable } from '../components/data-table.js';
import { closeModal, openModal } from '../components/modal.js';
import { wireRemoteAccess } from '../components/remote-access.js';
import { toast } from '../components/toast.js';
import { dashboardOrder } from './dashboard-order.js';
import { shouldRefreshDashboard } from './dashboard-refresh.js';
import {
  collapsibleMarkup,
  onboardingMarkup,
  recentActivityMarkup,
  runtimeOverviewMarkup,
} from './dashboard-view.js';

const openState = new Map();

function isOpen(id) {
  return openState.get(id) ?? true;
}

function connectorModal(reload) {
  openModal(
    'Create Bearer connector',
    `<p class="muted">OAuth is preferred. Use a fixed Bearer token only when the client requires it.</p>
     <form id="connector-form" class="stack-form"><input name="name" placeholder="Connector name" required><button class="primary">Create token</button></form><div id="connector-secret"></div>`,
    {
      onReady(body) {
        body
          .querySelector('#connector-form')
          .addEventListener('submit', async (event) => {
            event.preventDefault();
            const name = String(
              new FormData(event.target).get('name') ?? '',
            ).trim();
            if (!name) return;
            const created = await requestJson('/api/connectors', {
              method: 'POST',
              body: JSON.stringify({ name }),
            });
            body.querySelector('#connector-secret').innerHTML =
              `<div class="secret-result"><b>Copy this token now. It is shown once.</b><code>${escapeHtml(created.token)}</code><button type="button" id="copy-token">Copy token</button></div>`;
            body
              .querySelector('#copy-token')
              .addEventListener('click', async () => {
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
      {
        key: 'capabilities',
        label: 'Capabilities',
        value: (row) => (row.capabilities ?? []).join(', '),
        priority: 'low',
      },
      {
        key: 'lastActivityAt',
        label: 'Last activity',
        render: (row) => escapeHtml(localDateTime(row.lastActivityAt)),
      },
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
      {
        key: 'avgMs',
        label: 'Avg latency',
        render: (row) => `${Number(row.avgMs ?? 0)} ms`,
      },
      {
        key: 'totalMs',
        label: 'Total time',
        render: (row) => `${Number(row.totalMs ?? 0)} ms`,
        priority: 'low',
      },
    ],
    emptyText: 'No tool calls recorded in this runtime.',
  });

  mountDataTable(container.querySelector('#connections-table'), {
    id: 'dashboard-connectors',
    rows: snapshot.connectors ?? [],
    defaultSort: { key: 'lastUsedAt', dir: 'desc' },
    columns: [
      { key: 'name', label: 'Connector' },
      {
        key: 'createdAt',
        label: 'Created',
        render: (row) => escapeHtml(localDateTime(row.createdAt)),
        priority: 'low',
      },
      {
        key: 'lastUsedAt',
        label: 'Last used',
        render: (row) => escapeHtml(localDateTime(row.lastUsedAt)),
      },
      {
        key: 'actions',
        label: '',
        sortable: false,
        search: false,
        render: () =>
          '<button type="button" data-table-action="revoke">Revoke</button>',
      },
    ],
    onAction: async (action, row) => {
      if (action !== 'revoke' || !confirm(`Revoke ${row.name}?`)) return;
      await requestJson(`/api/connectors/${row.id}`, { method: 'DELETE' });
      toast('Connector revoked', 'success');
      await reload();
    },
  });
}

function dashboardSections(snapshot, onboarding, cloudflare, workspaces) {
  return {
    onboarding: collapsibleMarkup(
      'onboarding',
      'Onboarding',
      onboardingMarkup(onboarding, cloudflare, workspaces),
      isOpen('onboarding'),
    ),
    'runtime-overview': collapsibleMarkup(
      'runtime-overview',
      'Runtime overview',
      runtimeOverviewMarkup(snapshot),
      isOpen('runtime-overview'),
    ),
    'active-connections': collapsibleMarkup(
      'active-connections',
      'Active connections',
      '<div id="active-connections-table"></div>',
      isOpen('active-connections'),
    ),
    'tool-activity': collapsibleMarkup(
      'tool-activity',
      'Tool activity',
      '<div id="tool-activity-table"></div>',
      isOpen('tool-activity'),
    ),
    connections: collapsibleMarkup(
      'connections',
      'Connections',
      '<div class="panel-toolbar"><p>OAuth is recommended. Static Bearer connectors remain available when needed.</p><button type="button" id="create-connector">New connector</button></div><div id="connections-table"></div>',
      isOpen('connections'),
    ),
    'recent-activity': collapsibleMarkup(
      'recent-activity',
      'Recent activity',
      recentActivityMarkup(snapshot),
      isOpen('recent-activity'),
    ),
  };
}

export async function renderDashboardPage(container) {
  let stopped = false;
  let timer;

  const render = async ({ force = false } = {}) => {
    if (
      stopped ||
      !shouldRefreshDashboard(container, document.activeElement, force)
    ) {
      return;
    }

    const [snapshot, onboarding, cloudflare, workspaces] = await Promise.all([
      requestJson('/api/dashboard/runtime'),
      requestJson('/api/onboarding'),
      requestJson('/api/cloudflare/status'),
      requestJson('/api/workspaces'),
    ]);

    if (
      stopped ||
      !shouldRefreshDashboard(container, document.activeElement, force)
    ) {
      return;
    }

    const sections = dashboardSections(
      snapshot,
      onboarding,
      cloudflare,
      workspaces,
    );
    container.innerHTML = `<section class="page-head"><div><h2>Dashboard</h2><p>Local gateway runtime, connections, requests, and onboarding.</p></div></section>${dashboardOrder(
      onboarding.completed,
    )
      .map((id) => sections[id])
      .join('')}`;

    for (const details of container.querySelectorAll('[data-dashboard-section]')) {
      details.addEventListener('toggle', () =>
        openState.set(details.dataset.dashboardSection, details.open),
      );
    }

    const reload = () => render({ force: true });
    wireRemoteAccess(container, cloudflare, 'dashboard', reload);
    wireTables(container, snapshot, reload);
    container
      .querySelector('#create-connector')
      ?.addEventListener('click', () => connectorModal(reload));

    container
      .querySelector('#onboard-workspace')
      ?.addEventListener('submit', async (event) => {
        event.preventDefault();
        await requestJson('/api/workspaces', {
          method: 'POST',
          body: JSON.stringify(Object.fromEntries(new FormData(event.target))),
        });
        toast('Workspace registered', 'success');
        await reload();
      });

    container
      .querySelector('#finish-onboarding')
      ?.addEventListener('click', async () => {
        await requestJson('/api/onboarding', {
          method: 'PATCH',
          body: JSON.stringify({
            completed: true,
            completedSections: [
              'remote-access',
              'connect-ai',
              'workspace',
              'try-aevra',
              'explore',
            ],
          }),
        });
        toast('Onboarding completed', 'success');
        await reload();
      });
  };

  await render({ force: true });
  timer = setInterval(() => void render(), 2000);
  return () => {
    stopped = true;
    clearInterval(timer);
    closeModal();
  };
}
