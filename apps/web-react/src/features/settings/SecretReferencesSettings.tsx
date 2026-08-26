import { useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { deleteResource } from './settings-service';
import { SecretReferenceCreateModal } from './SecretReferenceCreateModal';

export function SecretReferencesSettings({
  secretRefs,
  onChanged,
}: {
  secretRefs: Array<Record<string, unknown> | string>;
  onChanged(): Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const rows = secretRefs.map((value) => ({
    ref: typeof value === 'string' ? value : String(value.ref ?? value.key ?? ''),
  }));

  return (
    <section className="panel wide settings-compact-panel">
      <div className="panel-head compact-panel-head">
        <div>
          <h3>Secret references</h3>
          <p>{rows.length} locally stored references.</p>
        </div>
        <button
          type="button"
          className="primary"
          data-surface-id="settings:store-secret"
          onClick={() => setCreating(true)}
        >
          Add secret
        </button>
      </div>
      <DataTable
        id="react-secret-references"
        rows={rows}
        columns={[
          { key: 'ref', label: 'Reference' },
          { key: 'state', label: 'State', value: () => 'Configured' },
          {
            key: 'actions',
            label: '',
            sortable: false,
            search: false,
            render: (row) => (
              <button
                type="button"
                data-surface-id="settings:remove-secret"
                onClick={() =>
                  void deleteResource(`/api/secret-references/${encodeURIComponent(row.ref)}`).then(
                    onChanged,
                  )
                }
              >
                Delete
              </button>
            ),
          },
        ]}
        rowKey={(row) => row.ref}
      />
      {creating ? (
        <SecretReferenceCreateModal onClose={() => setCreating(false)} onCreated={onChanged} />
      ) : null}
    </section>
  );
}
