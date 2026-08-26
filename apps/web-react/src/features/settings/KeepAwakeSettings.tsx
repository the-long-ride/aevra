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
    ? `${status.active ? 'Active' : 'Idle'} · ${status.reason}`
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
    <section className="panel keep-awake-panel">
      <div className="panel-head">
        <div>
          <h3>Keep awake</h3>
          <p>Prevent system idle sleep when Aevra needs to remain remotely reachable.</p>
        </div>
        <span className={`status ${status.active ? 'success' : ''}`}>{stateLabel}</span>
      </div>
      <form
        className="stack-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="field">
          <span>Prevent system sleep</span>
          <Dropdown
            ariaLabel="Prevent system sleep"
            value={mode}
            disabled={busy}
            onChange={(value) => setMode(value as KeepAwakeMode)}
            options={OPTIONS}
          />
        </label>
        <p className="section-note">
          Screen lock and display timeout remain unchanged. This only inhibits automatic system
          sleep.
        </p>
        {error ? <p role="alert">{error}</p> : null}
        <button className="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save keep awake'}
        </button>
      </form>
    </section>
  );
}
