import { requestJson } from '../core/api.js';
import { escapeHtml } from '../core/dom.js';
import { localDateTime } from '../core/time.js';
import { mountDataTable } from '../components/data-table.js';
import { toast } from '../components/toast.js';

export async function renderSessionsPage(container) {
  const render = async () => {
    const [remote, local, workspaces] = await Promise.all([
      requestJson('/api/sessions'),
      requestJson('/api/admin-sessions'),
      requestJson('/api/workspaces'),
    ]);
    const workspaceNames = new Map(
      workspaces.map((item) => [item.id, item.name]),
    );
    const workspaceOptions = workspaces
      .map(
        (item) =>
          `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`,
      )
      .join('');
    const remoteRows = remote.map((item) => {
      const workspaceId = item.lease?.workspaceId ?? null;
      return {
        ...item,
        workspaceId,
        workspaceName: workspaceId
          ? (workspaceNames.get(workspaceId) ?? workspaceId)
          : '—',
        workspaceState: item.activeLeaseId
          ? 'Workspace active'
          : 'No workspace',
      };
    });
    const localRows = local.map((item) => ({
      ...item,
      sessionHash: String(item.idHash),
    }));

    container.innerHTML = `<section class="page-head">
      <div><h2>Sessions</h2><p>Manage MCP and local admin sessions.</p></div>
      <button class="danger-button" type="button" id="revoke-other-sessions">Revoke all others</button>
    </section>
    <section class="panel"><div class="panel-head"><h3>Remote MCP sessions</h3><span>${remote.length} active</span></div><div id="remote-sessions-admin"></div></section>
    <section class="panel"><div class="panel-head"><h3>Local admin sessions</h3></div><div id="local-sessions-admin"></div></section>`;

    mountDataTable(container.querySelector('#remote-sessions-admin'), {
      id: 'remote-sessions-admin',
      rows: remoteRows,
      pageSize: 25,
      searchPlaceholder: 'Search remote sessions…',
      defaultSort: { key: 'lastActivityAt', dir: 'desc' },
      rowKey: (row) => row.id,
      filters: [
        { key: 'actor', label: 'Actor' },
        { key: 'workspaceState', label: 'Workspace state' },
      ],
      columns: [
        { key: 'actor', label: 'Actor' },
        {
          key: 'id',
          label: 'Session',
          render: (row) => `<code>${escapeHtml(row.id)}</code>`,
        },
        { key: 'workspaceName', label: 'Workspace' },
        {
          key: 'workspaceState',
          label: 'Workspace state',
          render: (row) =>
            `<span class="badge ${row.activeLeaseId ? 'good' : ''}">${escapeHtml(row.workspaceState)}</span>`,
        },
        {
          key: 'lastActivityAt',
          label: 'Last activity',
          render: (row) => escapeHtml(localDateTime(row.lastActivityAt)),
        },
        {
          key: 'actions',
          label: '',
          sortable: false,
          search: false,
          render: (row) => `<div class="actions"><select data-workspace-select="${escapeHtml(row.id)}">${workspaceOptions}</select><button type="button" data-table-action="switch">Switch</button><button type="button" data-table-action="revoke">Revoke</button></div>`,
        },
      ],
      onAction: async (action, row) => {
        if (action === 'revoke') {
          await requestJson(`/api/sessions/${encodeURIComponent(row.id)}/revoke`, {
            method: 'POST',
            body: '{}',
          });
          toast('Remote session revoked', 'success');
          await render();
          return;
        }
        if (action === 'switch') {
          const select = container.querySelector(
            `[data-workspace-select="${CSS.escape(row.id)}"]`,
          );
          if (!select?.value) return;
          await requestJson(
            `/api/sessions/${encodeURIComponent(row.id)}/workspace`,
            {
              method: 'POST',
              body: JSON.stringify({
                workspaceId: select.value,
                timeoutMs: 60000,
              }),
            },
          );
          toast('Workspace switched', 'success');
          await render();
        }
      },
    });

    mountDataTable(container.querySelector('#local-sessions-admin'), {
      id: 'local-sessions-admin',
      rows: localRows,
      pageSize: 25,
      searchPlaceholder: 'Search admin sessions…',
      defaultSort: { key: 'lastUsedAt', dir: 'desc' },
      rowKey: (row) => row.idHash,
      columns: [
        {
          key: 'sessionHash',
          label: 'Session hash',
          render: (row) =>
            `<code>${escapeHtml(row.sessionHash.slice(0, 18))}…</code>`,
        },
        {
          key: 'createdAt',
          label: 'Created',
          render: (row) => escapeHtml(localDateTime(row.createdAt)),
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
        if (action !== 'revoke') return;
        await requestJson(
          `/api/admin-sessions/${encodeURIComponent(row.idHash)}/revoke`,
          { method: 'POST', body: '{}' },
        );
        toast('Admin session revoked', 'success');
        await render();
      },
    });

    container
      .querySelector('#revoke-other-sessions')
      .addEventListener('click', async () => {
        if (
          !confirm(
            'Revoke every non-connector MCP session and every other local admin session? The current admin session plus OAuth and static connector sessions stay connected.',
          )
        ) {
          return;
        }
        await requestJson('/api/sessions/revoke-others', {
          method: 'POST',
          body: '{}',
        });
        toast('Other sessions revoked', 'success');
        await render();
      });
  };
  await render();
}
