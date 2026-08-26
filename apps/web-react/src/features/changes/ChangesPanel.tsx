import { DataTable } from '../../components/DataTable';
import { useDialog } from '../../components/Dialog';
import { PageState } from '../../components/PageState';
import { useApiResource } from '../../hooks/use-api-resource';
import { requestJson } from '../../services/api-client';

interface ChangeRow extends Record<string, unknown> {
  id: string;
  name?: string;
  state?: string;
  workspace_id?: string;
  updated_at?: string;
}

async function load(signal: AbortSignal) {
  return requestJson<ChangeRow[]>('/api/changes', { signal });
}

export function ChangesPanel({ contained = false }: { contained?: boolean }) {
  const resource = useApiResource(load);
  const dialog = useDialog();

  const rename = async (row: ChangeRow) => {
    const name = await dialog.prompt({
      title: 'Rename change set',
      label: 'Change-set name',
      initialValue: row.name ?? '',
      confirmLabel: 'Rename',
      required: true,
    });
    if (!name?.trim()) return;
    await requestJson(`/api/changes/${encodeURIComponent(row.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: name.trim() }),
    });
    await resource.refresh();
  };

  const mutate = async (row: ChangeRow, action: 'commit' | 'rollback') => {
    if (
      action === 'rollback' &&
      !(await dialog.confirm({
        title: 'Rollback change set',
        message: 'Rollback this change set? Conflicts will not overwrite newer work.',
        confirmLabel: 'Rollback',
        confirmTone: 'danger',
      }))
    ) {
      return;
    }
    await requestJson(`/api/changes/${encodeURIComponent(row.id)}/${action}`, {
      method: 'POST',
      body: '{}',
    });
    await resource.refresh();
  };

  return (
    <PageState loading={resource.loading} error={resource.error}>
      <DataTable
        id="react-changes"
        rows={resource.data ?? []}
        pageSize={25}
        searchPlaceholder="Search change sets…"
        paginationPosition={contained ? 'toolbar' : 'footer'}
        fillAvailableHeight={contained}
        filters={[{ key: 'state', label: 'State' }]}
        columns={[
          { key: 'name', label: 'Change set', value: (row) => row.name ?? row.id },
          { key: 'state', label: 'State' },
          { key: 'workspace_id', label: 'Workspace' },
          { key: 'updated_at', label: 'Updated', dateTime: true },
          {
            key: 'actions',
            label: '',
            sortable: false,
            search: false,
            render: (row) => (
              <div className="actions">
                <button
                  type="button"
                  data-surface-id="changes:rename"
                  onClick={() => void rename(row)}
                >
                  Rename
                </button>
                {row.state === 'OPEN' ? (
                  <>
                    <button
                      type="button"
                      data-surface-id="changes:commit"
                      onClick={() => void mutate(row, 'commit')}
                    >
                      Keep
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      data-surface-id="changes:rollback"
                      onClick={() => void mutate(row, 'rollback')}
                    >
                      Rollback
                    </button>
                  </>
                ) : null}
              </div>
            ),
          },
        ]}
        rowKey={(row) => row.id}
        emptyText="No change sets."
      />
    </PageState>
  );
}
