import { DataTable } from '../../components/DataTable';
import { useDialog } from '../../components/Dialog';
import { PageState } from '../../components/PageState';
import { useApiResource } from '../../hooks/use-api-resource';
import { requestJson } from '../../services/api-client';

interface ProcessCommand {
  executable?: string;
  args?: unknown[];
}

interface ProcessRow extends Record<string, unknown> {
  id: string;
  name?: string;
  workspace_id?: string;
  workspace_name?: string;
  ownership?: string;
  lifecycle?: string;
  state?: string;
  created_at?: string;
  command?: ProcessCommand | string;
}

async function load(signal: AbortSignal) {
  return requestJson<ProcessRow[]>('/api/processes', { signal });
}

function processName(row: ProcessRow) {
  const explicit = String(row.name ?? '').trim();
  if (explicit) return explicit;
  if (typeof row.command === 'string' && row.command.trim()) return row.command.trim();
  if (row.command && typeof row.command === 'object') {
    const executable = String(row.command.executable ?? '').trim();
    if (executable) {
      const args = Array.isArray(row.command.args) ? row.command.args.map(String) : [];
      return [executable, ...args].join(' ');
    }
  }
  return row.id;
}

export function ProcessesPanel({ contained = false }: { contained?: boolean }) {
  const resource = useApiResource(load);
  const dialog = useDialog();

  const mutate = async (id: string, action: 'stop' | 'restart' | 'forget') => {
    await requestJson(`/api/processes/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      body: '{}',
    });
    await resource.refresh();
  };

  return (
    <PageState loading={resource.loading} error={resource.error}>
      <DataTable
        id="react-processes"
        rows={resource.data ?? []}
        pageSize={25}
        searchPlaceholder="Search processes…"
        paginationPosition={contained ? 'toolbar' : 'footer'}
        fillAvailableHeight={contained}
        filters={[
          { key: 'state', label: 'State' },
          { key: 'ownership', label: 'Ownership' },
          { key: 'lifecycle', label: 'Lifecycle' },
        ]}
        columns={[
          {
            key: 'name',
            label: 'Name',
            value: processName,
            render: (row) => {
              const name = processName(row);
              const showName = () =>
                void dialog.message({
                  title: 'Process command / name',
                  message: (
                    <code
                      style={{
                        display: 'block',
                        padding: '8px 12px',
                        background: 'var(--surface-soft)',
                        border: '1px solid var(--hairline)',
                        wordBreak: 'break-all',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {name}
                    </code>
                  ),
                  actionLabel: 'Close',
                });
              return (
                <button
                  type="button"
                  className="process-name-button"
                  title={name}
                  onClick={showName}
                >
                  <code className="process-name-cell">{name}</code>
                </button>
              );
            },
          },
          { key: 'id', label: 'Process ID' },
          {
            key: 'workspace_name',
            label: 'Workspace',
            value: (row) => row.workspace_name ?? row.workspace_id ?? '',
          },
          { key: 'state', label: 'State' },
          { key: 'ownership', label: 'Ownership' },
          { key: 'lifecycle', label: 'Lifecycle' },
          { key: 'created_at', label: 'Started', dateTime: true },
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
    </PageState>
  );
}
