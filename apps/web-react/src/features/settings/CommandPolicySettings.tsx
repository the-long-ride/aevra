import { useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { Dropdown } from '../../components/Dropdown';
import { patchJson } from './settings-service';
import { SettingsFormModal } from './SettingsFormModal';

const EFFECTS = ['READ_ONLY', 'BUILD_OUTPUT', 'SOURCE_MUTATION', 'REPOSITORY_STATE', 'UNKNOWN'].map(
  (value) => ({ value, label: value }),
);

export function CommandPolicySettings({
  families,
  onChanged,
}: {
  families: Record<string, string>;
  onChanged(): Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const close = () => {
    setError('');
    setCreating(false);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Object.fromEntries(new FormData(event.currentTarget));
    setSubmitting(true);
    setError('');
    try {
      await patchJson('/api/policy/command-families', {
        ...families,
        [String(value.family)]: value.effect,
      });
      close();
      await onChanged().catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="panel settings-compact-panel">
      <div className="panel-head compact-panel-head">
        <div>
          <h3>Command-family overrides</h3>
          <p>{Object.keys(families).length} configured overrides.</p>
        </div>
        <button type="button" className="primary" onClick={() => setCreating(true)}>
          Add override
        </button>
      </div>
      <DataTable
        id="react-command-families"
        rows={Object.entries(families).map(([family, effect]) => ({ family, effect }))}
        columns={[
          { key: 'family', label: 'Family' },
          { key: 'effect', label: 'Effect' },
          {
            key: 'actions',
            label: '',
            sortable: false,
            search: false,
            render: (row) => (
              <button
                type="button"
                data-surface-id="settings:remove-command-family"
                onClick={() => {
                  const next = { ...families };
                  delete next[row.family];
                  void patchJson('/api/policy/command-families', next).then(onChanged);
                }}
              >
                Remove
              </button>
            ),
          },
        ]}
        rowKey={(row) => row.family}
      />
      {creating ? (
        <SettingsFormModal
          title="Add command-family override"
          description="Override the operation classification for one exact command family."
          submitting={submitting}
          submitLabel="Set override"
          submittingLabel="Saving…"
          onClose={close}
          onSubmit={submit}
        >
          <div className="settings-modal-fields">
            <label className="field">
              <span>Family</span>
              <input name="family" autoFocus required />
            </label>
            <label className="field">
              <span>Effect</span>
              <Dropdown
                name="effect"
                ariaLabel="Effect"
                defaultValue="READ_ONLY"
                options={EFFECTS}
              />
            </label>
            {error ? (
              <p role="alert" className="inline-result warning-text">
                {error}
              </p>
            ) : null}
          </div>
        </SettingsFormModal>
      ) : null}
    </section>
  );
}
