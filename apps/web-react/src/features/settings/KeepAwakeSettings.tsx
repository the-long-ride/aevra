import { useState } from 'react';
import type { KeepAwakeMode, KeepAwakeStatus } from '@aevra/admin-contracts';
import { Dropdown } from '../../components/Dropdown';

const OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'remote-connections', label: 'While remote connections are active' },
  { value: 'managed-processes', label: 'While managed processes are running' },
  { value: 'always', label: 'While Aevra is running' },
];

export function KeepAwakeSettings({
  status,
  onSave,
}: {
  status: KeepAwakeStatus;
  onSave(mode: KeepAwakeMode): Promise<void>;
}) {
  const [mode, setMode] = useState<KeepAwakeMode>(status.mode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stateLabel = status.supported
    ? status.reason
    : `Unavailable${status.message ? ` · ${status.message}` : ''}`;

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onSave(mode);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="panel keep-awake-panel compact-settings-panel settings-compact-panel"
      role="region"
      aria-label="Keep awake"
    >
      <span
        className={`keep-awake-status-dot${status.supported && status.active ? ' is-active' : ''}`}
        aria-label={
          status.supported && status.active
            ? 'Sleep inhibition enabled'
            : 'Sleep inhibition disabled'
        }
        title={
          status.supported && status.active
            ? 'Sleep inhibition enabled'
            : 'Sleep inhibition disabled'
        }
      />
      <div className="compact-settings-copy keep-awake-copy">
        <h3>Keep awake</h3>
        <span className="keep-awake-state-label">{stateLabel}</span>
      </div>
      <form
        className="compact-keep-awake-controls"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Dropdown
          ariaLabel="Prevent system sleep"
          value={mode}
          disabled={busy}
          onChange={(value) => setMode(value as KeepAwakeMode)}
          options={OPTIONS}
        />
        <button className="primary" aria-label="Save keep awake" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </form>
      <p className="section-note compact-settings-note">
        Prevents automatic system sleep only; screen lock and display timeout remain unchanged.
      </p>
      {error ? (
        <p role="alert" className="inline-result warning-text">
          {error}
        </p>
      ) : null}
    </section>
  );
}
