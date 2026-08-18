import { requestJson } from '../core/api.js';
import { escapeHtml } from '../core/dom.js';
import { mountDataTable } from '../components/data-table.js';
import {
  openNewWorkspace,
  openWorkspaceDetail,
} from '../components/workspace-detail.js';
import { toast } from '../components/toast.js';

export async function renderWorkspacesPage(container) {
  const render = async () => {
    const workspaces = await requestJson('/api/workspaces');
    const expanded = await Promise.all(
      workspaces.map(async (item) => ({
        ...item,
        mounts: await requestJson(
          `/api/workspaces/${encodeURIComponent(item.id)}/mounts`,
        ),
      })),
    );
    const rows = expanded.map((item) => ({
      ...item,
      mountCount: item.mounts.length,
      mountState: item.mounts.length ? 'Has mounts' : 'No mounts',
    }));
    container.innerHTML = `<section class="page-head">
      <div><h2>Workspaces</h2><p>Primary project roots with optional external directory mounts and connector admission.</p></div>
      <button class="primary" type="button" id="add-workspace">Add workspace</button>
    </section>
    <section class="panel"><div id="workspaces-admin"></div></section>`;
    mountDataTable(container.querySelector('#workspaces-admin'), {
      id: 'workspaces-admin',
      rows,
      pageSize: 25,
      searchPlaceholder: 'Search workspaces…',
      defaultSort: { key: 'name', dir: 'asc' },
      filters: [{ key: 'mountState', label: 'External mounts' }],
      rowKey: (row) => row.id,
      columns: [
        {
          key: 'name',
          label: 'Workspace',
          render: (row) => `<strong>${escapeHtml(row.name)}</strong>`,
        },
        {
          key: 'hostRoot',
          label: 'Local root',
          render: (row) => `<code>${escapeHtml(row.hostRoot ?? '')}</code>`,
        },
        { key: 'mountCount', label: 'Mounts' },
        {
          key: 'description',
          label: 'Description',
          render: (row) => escapeHtml(row.description ?? '—'),
        },
        {
          key: 'actions',
          label: '',
          sortable: false,
          search: false,
          render: () =>
            '<div class="actions"><button type="button" data-table-action="details">Details</button><button type="button" class="danger-button" data-table-action="remove">Remove</button></div>',
        },
      ],
      onAction: async (action, row) => {
        if (action === 'details') {
          await openWorkspaceDetail(row.id, render);
          return;
        }
        if (
          action === 'remove' &&
          confirm('Remove this workspace registration?')
        ) {
          await requestJson(`/api/workspaces/${encodeURIComponent(row.id)}`, {
            method: 'DELETE',
          });
          toast('Workspace removed', 'success');
          await render();
        }
      },
    });
    container
      .querySelector('#add-workspace')
      .addEventListener('click', () => openNewWorkspace(render));
  };
  await render();
}
