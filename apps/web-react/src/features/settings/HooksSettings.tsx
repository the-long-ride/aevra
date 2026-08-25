import { useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { HookCreateModal } from './HookCreateModal';
import { deleteResource, patchJson, type HookSetting } from './settings-service';

export function HooksSettings({
  hooks,
  onChanged,
}: {
  hooks: HookSetting[];
  onChanged: () => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);

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
                  onClick={() =>
                    void deleteResource(`/api/hooks/${encodeURIComponent(row.id)}`).then(onChanged)
                  }
                >
                  Delete
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
