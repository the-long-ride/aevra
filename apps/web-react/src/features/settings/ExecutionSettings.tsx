import { useState } from 'react';
import { Dropdown } from '../../components/Dropdown';
import { patchJson } from './settings-service';

export function ExecutionSettings({
  execution,
  onChanged,
}: {
  execution: Record<string, unknown>;
  onChanged(): Promise<void>;
}) {
  const [backend, setBackend] = useState(String(execution.sandboxBackend ?? 'auto'));
  const [advanced, setAdvanced] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Object.fromEntries(new FormData(event.currentTarget));
    await patchJson('/api/execution-settings', {
      ...value,
      workspaceDrainMs: Number(value.workspaceDrainMs),
      searchMaxQueries: Number(value.searchMaxQueries),
    });
    await onChanged();
  };

  return (
    <section className="panel settings-compact-panel execution-panel">
      <div className="panel-head compact-panel-head">
        <div>
          <h3>Execution</h3>
          <p>Choose isolation and cache behavior for workspace commands.</p>
        </div>
      </div>
      <form className="compact-settings-form" onSubmit={submit}>
        <div className="compact-control-grid">
          <label className="field">
            <span>Sandbox backend</span>
            <Dropdown
              name="sandboxBackend"
              ariaLabel="Sandbox backend"
              value={backend}
              onChange={setBackend}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'docker', label: 'Docker' },
                { value: 'podman', label: 'Podman' },
                { value: 'native', label: 'Native host' },
              ]}
            />
          </label>
          <label className="field">
            <span>Cache policy</span>
            <Dropdown
              name="cachePolicy"
              ariaLabel="Cache policy"
              defaultValue={String(execution.cachePolicy ?? 'workspace')}
              options={[
                { value: 'workspace', label: 'Workspace' },
                { value: 'shared', label: 'Shared' },
                { value: 'disabled', label: 'Disabled' },
              ]}
            />
          </label>
        </div>
        {backend === 'native' ? (
          <p className="execution-warning" role="status">
            Direct computer access — no container isolation. Commands still pass through Aevra
            permissions and approvals.
          </p>
        ) : null}
        <button
          type="button"
          className="compact-disclosure"
          aria-expanded={advanced}
          onClick={() => setAdvanced((value) => !value)}
        >
          Advanced execution settings
        </button>
        {advanced ? (
          <div className="compact-control-grid execution-advanced">
            <label className="field">
              <span>Drain timeout (ms)</span>
              <input
                type="number"
                name="workspaceDrainMs"
                defaultValue={Number(execution.workspaceDrainMs ?? 60000)}
              />
            </label>
            <label className="field">
              <span>Parallel search values (N)</span>
              <input
                type="number"
                name="searchMaxQueries"
                min={1}
                max={32}
                defaultValue={Number(execution.searchMaxQueries ?? 8)}
              />
            </label>
          </div>
        ) : (
          <>
            <input
              type="hidden"
              name="workspaceDrainMs"
              value={Number(execution.workspaceDrainMs ?? 60000)}
            />
            <input
              type="hidden"
              name="searchMaxQueries"
              value={Number(execution.searchMaxQueries ?? 8)}
            />
          </>
        )}
        <div className="compact-settings-actions">
          <button className="primary" data-surface-id="settings:save-execution">
            Save execution
          </button>
        </div>
      </form>
    </section>
  );
}
