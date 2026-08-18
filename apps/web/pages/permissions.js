import { requestJson } from '../core/api.js';
import { escapeHtml } from '../core/dom.js';
import { localDateTime } from '../core/time.js';
import { mountDataTable } from '../components/data-table.js';
import { openPermissionBulkEditor } from '../components/permission-bulk.js';
import { toast } from '../components/toast.js';

export async function renderPermissionsPage(container) {
  const render = async () => {
    const [rules, workspaces, sessions, connectors, oauthClients] =
      await Promise.all([
        requestJson('/api/permissions'),
        requestJson('/api/workspaces'),
        requestJson('/api/sessions'),
        requestJson('/api/connectors'),
        requestJson('/api/oauth/clients'),
      ]);
    const workspaceNames = new Map(
      workspaces.map((item) => [item.id, item.name]),
    );
    const sessionNames = new Map(
      sessions.map((item) => [
        item.id,
        `${item.actor} · ${String(item.id).slice(0, 12)}…`,
      ]),
    );
    const rows = rules.map((rule) => {
      const scope = rule.scope ?? '—';
      const workspaceId = rule.workspace_id ?? rule.workspaceId;
      const sessionId = rule.session_id ?? rule.sessionId;
      return {
        ...rule,
        id: rule.id,
        effect: rule.effect ?? '—',
        capability: rule.capability ?? '—',
        scope,
        actor: rule.actor ?? 'Any actor',
        target:
          scope === 'workspace'
            ? (workspaceNames.get(workspaceId) ?? workspaceId ?? '—')
            : scope === 'session'
              ? (sessionNames.get(sessionId) ?? sessionId ?? '—')
              : 'All workspaces',
        matcher: rule.matcher ?? '*',
        created: rule.created_at ?? rule.createdAt ?? '',
      };
    });

    container.innerHTML = `<section class="page-head">
      <div><h2>Permissions</h2><p>Create connector permission records and manage remembered rules.</p></div>
      <button class="primary" type="button" id="add-permission-rules">Add rules</button>
    </section>
    <section class="panel"><div id="permissions-admin"></div></section>`;

    mountDataTable(container.querySelector('#permissions-admin'), {
      id: 'permissions-admin',
      rows,
      pageSize: 25,
      searchPlaceholder: 'Search permissions…',
      defaultSort: { key: 'created', dir: 'desc' },
      filters: [
        { key: 'effect', label: 'Effect' },
        { key: 'capability', label: 'Capability' },
        { key: 'scope', label: 'Scope' },
        { key: 'actor', label: 'Connector / actor' },
      ],
      columns: [
        {
          key: 'effect',
          label: 'Effect',
          render: (row) =>
            `<span class="badge ${row.effect === 'allow' ? 'good' : ''}">${escapeHtml(row.effect)}</span>`,
        },
        {
          key: 'capability',
          label: 'Capability',
          render: (row) => `<code>${escapeHtml(row.capability)}</code>`,
        },
        { key: 'scope', label: 'Scope' },
        { key: 'actor', label: 'Connector / actor' },
        { key: 'target', label: 'Target' },
        {
          key: 'matcher',
          label: 'Matcher',
          render: (row) => `<code>${escapeHtml(row.matcher)}</code>`,
        },
        {
          key: 'created',
          label: 'Created',
          render: (row) => escapeHtml(localDateTime(row.created)),
          priority: 'low',
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
        if (action !== 'revoke') return;
        await requestJson(`/api/permissions/${encodeURIComponent(row.id)}`, {
          method: 'DELETE',
        });
        toast('Permission revoked', 'success');
        await render();
      },
    });

    container
      .querySelector('#add-permission-rules')
      .addEventListener('click', () =>
        openPermissionBulkEditor(
          { workspaces, sessions, connectors, oauthClients },
          render,
        ),
      );
  };

  await render();
}
