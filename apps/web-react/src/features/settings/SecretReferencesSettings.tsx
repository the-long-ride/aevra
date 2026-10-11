import { useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { useDialog } from '../../components/Dialog';
import { useToast } from '../../components/Toast';
import { deleteResource } from './settings-service';
import { SecretReferenceCreateModal } from './SecretReferenceCreateModal';

type SecretDialog = { mode: 'create' } | { mode: 'edit'; reference: string };

// The list endpoint returns `{ id, keyRef, … }`; older shapes used `ref` / `key`.
function referenceName(value: Record<string, unknown> | string): string {
  if (typeof value === 'string') return value;
  return String(value.ref ?? value.id ?? value.keyRef ?? value.key ?? '');
}

export function SecretReferencesSettings({
  secretRefs,
  onChanged,
}: {
  secretRefs: Array<Record<string, unknown> | string>;
  onChanged(): Promise<void>;
}) {
  const dialog = useDialog();
  const { toast, success, error } = useToast();
  const [editor, setEditor] = useState<SecretDialog | null>(null);
  const rows = secretRefs.map((value) => ({ ref: referenceName(value) }));

  const handleDelete = async (ref: string) => {
    const confirmed = await dialog.confirm({
      title: 'Delete secret reference',
      message: `Delete secret reference "${ref}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      confirmTone: 'danger',
    });
    if (!confirmed) return;
    try {
      await deleteResource(`/api/secret-references/${encodeURIComponent(ref)}`);
      success(`Secret reference "${ref}" deleted.`);
      await onChanged();
    } catch (cause) {
      error(cause);
    }
  };

  return (
    <section className="panel settings-compact-panel">
      <div className="panel-head compact-panel-head">
        <div>
          <h3>Secret references</h3>
          <p>{rows.length} locally stored references.</p>
        </div>
        <button
          type="button"
          className="primary"
          data-surface-id="settings:store-secret"
          onClick={() => setEditor({ mode: 'create' })}
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
              <div className="actions">
                <button
                  type="button"
                  className="secondary"
                  aria-label={`Edit ${row.ref}`}
                  title="Update value"
                  data-surface-id="settings:edit-secret"
                  onClick={() => setEditor({ mode: 'edit', reference: row.ref })}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="danger-button"
                  aria-label="Delete"
                  title="Delete"
                  data-surface-id="settings:remove-secret"
                  onClick={() => void handleDelete(row.ref)}
                >
                  [x]
                </button>
              </div>
            ),
          },
        ]}
        rowKey={(row) => row.ref}
      />
      {editor ? (
        <SecretReferenceCreateModal
          reference={editor.mode === 'edit' ? editor.reference : undefined}
          onClose={() => setEditor(null)}
          onCreated={async () => {
            success(
              editor.mode === 'edit'
                ? `Secret value for "${editor.reference}" updated.`
                : 'Secret reference stored.',
            );
            await onChanged();
          }}
        />
      ) : null}
      {toast}
    </section>
  );
}
