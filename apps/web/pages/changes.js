import { requestJson } from '../core/api.js';
import { escapeHtml } from '../core/dom.js';
import { localDateTime } from '../core/time.js';
import { mountDataTable } from '../components/data-table.js';
import { closeModal, openModal } from '../components/modal.js';
import { toast } from '../components/toast.js';

function renameChange(change, reload) {
  openModal(
    'Rename change set',
    `<form id="rename-change" class="stack-form"><input name="name" value="${escapeHtml(change.name ?? '')}" placeholder="Change-set name" required><button class="primary">Rename</button></form>`,
    {
      onReady(body) {
        body.querySelector('#rename-change').addEventListener('submit', async (event) => {
          event.preventDefault();
          await requestJson(`/api/changes/${change.id}`, {
            method: 'PATCH',
            body: JSON.stringify(Object.fromEntries(new FormData(event.target))),
          });
          closeModal();
          toast('Change set renamed', 'success');
          await reload();
        });
      },
    },
  );
}

export async function renderChangesPage(container) {
  const render = async () => {
    const items = await requestJson('/api/changes');
    container.innerHTML = `<section class="page-head"><div><h2>Changes</h2><p>Recovery-aware change sets.</p></div></section><section class="panel"><div id="changes-table"></div></section>`;
    mountDataTable(container.querySelector('#changes-table'), {
      id: 'changes-admin',
      rows: items,
      pageSize: 25,
      searchPlaceholder: 'Search change sets…',
      filters: [{ key: 'state', label: 'State' }],
      columns: [
        {
          key: 'name',
          label: 'Change set',
          value: (row) => row.name ?? row.id,
          render: (row) => escapeHtml(row.name ?? row.id),
        },
        { key: 'state', label: 'State' },
        { key: 'workspace_id', label: 'Workspace' },
        {
          key: 'updated_at',
          label: 'Updated',
          render: (row) =>
            escapeHtml(localDateTime(row.updated_at ?? row.created_at)),
          priority: 'low',
        },
        {
          key: 'actions',
          label: '',
          sortable: false,
          search: false,
          render: (row) => `<div class="actions">
            <button type="button" data-table-action="rename">Rename</button>
            ${
              row.state === 'OPEN'
                ? '<button type="button" data-table-action="commit">Keep</button><button type="button" class="danger-button" data-table-action="rollback">Rollback</button>'
                : ''
            }
          </div>`,
        },
      ],
      onAction: async (action, row) => {
        if (action === 'rename') {
          renameChange(row, render);
          return;
        }
        if (action === 'rollback' && !confirm('Rollback this change set? Conflicts will not overwrite newer work.')) return;
        if (!['commit', 'rollback'].includes(action)) return;
        await requestJson(`/api/changes/${row.id}/${action}`, {
          method: 'POST',
          body: '{}',
        });
        toast(action === 'commit' ? 'Change set kept' : 'Change set rolled back', 'success');
        await render();
      },
      emptyText: 'No change sets.',
    });
  };
  await render();
  return () => closeModal();
}
