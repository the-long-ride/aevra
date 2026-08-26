import { useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { EnvironmentProfileCreateModal } from './EnvironmentProfileCreateModal';

export function EnvironmentProfilesSettings({
  profiles,
  onChanged,
}: {
  profiles: Array<Record<string, unknown>>;
  onChanged(): Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <section className="panel wide settings-compact-panel">
      <div className="panel-head compact-panel-head">
        <div>
          <h3>Environment profiles</h3>
          <p>{profiles.length} reusable profiles.</p>
        </div>
        <button
          type="button"
          className="primary"
          data-surface-id="settings:create-environment-profile"
          onClick={() => setCreating(true)}
        >
          Create profile
        </button>
      </div>
      <DataTable
        id="react-environment-profiles"
        rows={profiles}
        columns={[
          { key: 'name', label: 'Name' },
          { key: 'vars', label: 'Variables' },
          { key: 'secretRefs', label: 'Secret references' },
        ]}
      />
      {creating ? (
        <EnvironmentProfileCreateModal onClose={() => setCreating(false)} onCreated={onChanged} />
      ) : null}
    </section>
  );
}
