import { requestJson } from '../core/api.js';
import { escapeHtml } from '../core/dom.js';
import { localDateTime } from '../core/time.js';
import { mountDataTable } from '../components/data-table.js';
import { toast } from '../components/toast.js';

export async function renderProcessesPage(container) {
  const render = async () => {
    const items = await requestJson('/api/processes');
    container.innerHTML = `<section class="page-head"><div><h2>Processes</h2><p>Managed commands owned by registered workspaces.</p></div></section><section class="panel"><div id="process-table"></div></section>`;
    mountDataTable(container.querySelector('#process-table'), {
      id: 'processes-admin',
      rows: items,
      pageSize: 25,
      searchPlaceholder: 'Search processes…',
      filters: [
        { key: 'ownership', label: 'Ownership' },
        { key: 'lifecycle', label: 'Lifecycle' },
      ],
      columns: [
        {
          key: 'id',
          label: 'Process',
          render: (row) => `<code>${escapeHtml(row.id)}</code>`,
        },
        { key: 'workspace_id', label: 'Workspace' },
        { key: 'ownership', label: 'Ownership' },
        { key: 'lifecycle', label: 'Lifecycle', priority: 'low' },
        {
          key: 'created_at',
          label: 'Started',
          render: (row) => escapeHtml(localDateTime(row.created_at)),
          priority: 'low',
        },
        {
          key: 'actions',
          label: '',
          sortable: false,
          search: false,
          render: (row) => `<div class="actions">
            <button type="button" data-table-action="stop" ${row.ownership === 'detached-uncertain' ? 'disabled' : ''}>Stop</button>
            <button type="button" data-table-action="restart" ${row.ownership === 'detached-uncertain' ? 'disabled' : ''}>Restart</button>
            <button type="button" class="danger-button" data-table-action="forget">Forget</button>
          </div>`,
        },
      ],
      onAction: async (action, row) => {
        if (!['stop', 'restart', 'forget'].includes(action)) return;
        await requestJson(`/api/processes/${row.id}/${action}`, {
          method: 'POST',
          body: '{}',
        });
        toast(`Process ${action} completed`, 'success');
        await render();
      },
      emptyText: 'No managed processes.',
    });
  };
  await render();
}
