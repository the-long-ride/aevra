import { useState } from 'react';
import type { WorkspaceSummary } from '@aevra/admin-contracts';
import { DataTable } from '../../components/DataTable';
import { Dropdown } from '../../components/Dropdown';
import { deleteResource, postJson } from './settings-service';
import { SettingsFormModal } from './SettingsFormModal';

export function NetworkPolicySettings({
  rules,
  workspaces,
  onChanged,
}: {
  rules: Array<Record<string, unknown>>;
  workspaces: WorkspaceSummary[];
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
      await postJson('/api/policy/network-rules', {
        ...value,
        port: Number(value.port),
        workspaceId: value.workspaceId || undefined,
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
          <h3>Network rules</h3>
          <p>{rules.length} configured rules.</p>
        </div>
        <button type="button" className="primary" onClick={() => setCreating(true)}>
          Add rule
        </button>
      </div>
      <DataTable
        id="react-network-rules"
        rows={rules}
        columns={[
          { key: 'effect', label: 'Effect' },
          { key: 'protocol', label: 'Protocol' },
          { key: 'host', label: 'Host' },
          { key: 'port', label: 'Port' },
          { key: 'workspaceId', label: 'Workspace' },
          {
            key: 'actions',
            label: '',
            sortable: false,
            search: false,
            render: (row) => (
              <button
                type="button"
                data-surface-id="settings:remove-network-rule"
                onClick={() =>
                  void deleteResource(`/api/policy/network-rules/${String(row.id)}`).then(onChanged)
                }
              >
                Remove
              </button>
            ),
          },
        ]}
      />
      {creating ? (
        <SettingsFormModal
          title="Add network rule"
          description="Allow or deny one network destination, globally or for a workspace."
          submitting={submitting}
          submitLabel="Add rule"
          submittingLabel="Adding…"
          onClose={close}
          onSubmit={submit}
        >
          <div className="settings-modal-fields settings-modal-grid">
            <label className="field">
              <span>Effect</span>
              <Dropdown
                name="effect"
                ariaLabel="Effect"
                defaultValue="allow"
                options={[
                  { value: 'allow', label: 'Allow' },
                  { value: 'deny', label: 'Deny' },
                ]}
              />
            </label>
            <label className="field">
              <span>Protocol</span>
              <input name="protocol" defaultValue="https" required />
            </label>
            <label className="field">
              <span>Host</span>
              <input name="host" autoFocus required />
            </label>
            <label className="field">
              <span>Port</span>
              <input type="number" name="port" defaultValue={443} required />
            </label>
            <label className="field settings-modal-wide">
              <span>Workspace</span>
              <Dropdown
                name="workspaceId"
                ariaLabel="Workspace"
                defaultValue=""
                options={[
                  { value: '', label: 'Global' },
                  ...workspaces.map((workspace) => ({
                    value: workspace.id,
                    label: workspace.name,
                  })),
                ]}
              />
            </label>
            {error ? (
              <p role="alert" className="inline-result warning-text settings-modal-wide">
                {error}
              </p>
            ) : null}
          </div>
        </SettingsFormModal>
      ) : null}
    </section>
  );
}
