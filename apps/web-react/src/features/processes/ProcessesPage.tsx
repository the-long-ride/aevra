import { DataTable } from '../../components/DataTable';
import { PageState } from '../../components/PageState';
import { useApiResource } from '../../hooks/use-api-resource';
import { requestJson } from '../../services/api-client';

interface ProcessRow extends Record<string, unknown> {
  id: string;
  workspace_id?: string;
  ownership?: string;
  lifecycle?: string;
  created_at?: string;
}

async function load(signal: AbortSignal) {
  return requestJson<ProcessRow[]>('/api/processes', { signal });
}

export function ProcessesPage() {
  const resource = useApiResource(load);

  const mutate = async (id: string, action: 'stop' | 'restart' | 'forget') => {
    await requestJson(`/api/processes/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      body: '{}',
    });
    await resource.refresh();
  };

  return (
    <PageState loading={resource.loading} error={resource.error}>
      <section className="page-head">
        <div>
          <h2>Processes</h2>
          <p>Managed commands owned by registered workspaces.</p>
        </div>
      </section>
      <section className="panel">
        <DataTable
          id="react-processes"
          rows={resource.data ?? []}
          pageSize={25}
          searchPlaceholder="Search processes…"
          filters={[
            { key: 'ownership', label: 'Ownership' },
            { key: 'lifecycle', label: 'Lifecycle' },
          ]}
          columns={[
            { key: 'id', label: 'Process' },
            { key: 'workspace_id', label: 'Workspace' },
            { key: 'ownership', label: 'Ownership' },
            { key: 'lifecycle', label: 'Lifecycle' },
            { key: 'created_at', label: 'Started' },
            {
              key: 'actions',
              label: '',
              sortable: false,
              search: false,
              render: (row) => (
                <div className="actions">
                  <button
                    type="button"
                    data-surface-id="processes:stop"
                    disabled={row.ownership === 'detached-uncertain'}
                    onClick={() => void mutate(row.id, 'stop')}
                  >
                    Stop
                  </button>
                  <button
                    type="button"
                    data-surface-id="processes:restart"
                    disabled={row.ownership === 'detached-uncertain'}
                    onClick={() => void mutate(row.id, 'restart')}
                  >
                    Restart
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    data-surface-id="processes:forget"
                    onClick={() => void mutate(row.id, 'forget')}
                  >
                    Forget
                  </button>
                </div>
              ),
            },
          ]}
          rowKey={(row) => row.id}
          emptyText="No managed processes."
        />
      </section>
    </PageState>
  );
}
