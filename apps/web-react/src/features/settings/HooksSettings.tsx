import { useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { useDialog } from '../../components/Dialog';
import { HookCreateModal } from './HookCreateModal';
import { deleteResource, patchJson, type HookSetting } from './settings-service';

export function HooksSettings({
  hooks,
  onChanged,
}: {
  hooks: HookSetting[];
  onChanged: () => Promise<void>;
}) {
  const dialog = useDialog();
  const [creating, setCreating] = useState(false);

  const handleDelete = async (id: string) => {
    const confirmed = await dialog.confirm({
      title: 'Delete hook',
      message: 'Delete this lifecycle hook? This cannot be undone.',
      confirmLabel: 'Delete',
      confirmTone: 'danger',
    });
    if (!confirmed) return;
    await deleteResource(`/api/hooks/${encodeURIComponent(id)}`);
    await onChanged();
  };

  return (
    <section className="panel wide hooks-panel">
      <div className="panel-head">
        <div>
          <h3>Lifecycle hooks</h3>
          <p>
            Run or launch local applications on MCP lifecycle events. Mutation permissions are
            privileged and transformed tool calls are authorized again before execution.
          </p>
        </div>
        <button
          type="button"
          className="primary"
          data-surface-id="settings:add-hook"
          onClick={() => setCreating(true)}
        >
          Add hook
        </button>
      </div>

      <DataTable
        id="react-hooks"
        rows={hooks}
        columns={[
          { key: 'name', label: 'Name' },
          { key: 'event', label: 'Event' },
          { key: 'kind', label: 'Kind' },
          { key: 'executable', label: 'Executable' },
          { key: 'execution', label: 'Execution' },
          {
            key: 'permissions',
            label: 'Permissions',
            value: (row) =>
              row.permissions?.length ? row.permissions.join(', ') : 'observe, block',
          },
          { key: 'failurePolicy', label: 'Failure' },
          { key: 'enabled', label: 'Enabled', value: (row) => (row.enabled ? 'Yes' : 'No') },
          {
            key: 'actions',
            label: '',
            sortable: false,
            search: false,
            render: (row) => (
              <div className="actions">
                <button
                  type="button"
                  onClick={() =>
                    void patchJson(`/api/hooks/${encodeURIComponent(row.id)}`, {
                      enabled: !row.enabled,
                    }).then(onChanged)
                  }
                >
                  {row.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  type="button"
                  className="danger-button"
                  aria-label="Delete"
                  title="Delete"
                  onClick={() => void handleDelete(row.id)}
                >
                  [x]
                </button>
              </div>
            ),
          },
        ]}
        rowKey={(row) => row.id}
      />

      {creating ? (
        <HookCreateModal onClose={() => setCreating(false)} onCreated={onChanged} />
      ) : null}
    </section>
  );
}
