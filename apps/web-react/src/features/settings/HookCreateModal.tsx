import { useEffect, useState } from 'react';
import { Dropdown } from '../../components/Dropdown';
import { Switch } from '../../components/Switch';
import { postJson } from './settings-service';

const EVENTS = [
  'session_start',
  'session_connect',
  'session_reconnect',
  'request_received',
  'prompt_received',
  'before_tool_call',
  'after_tool_call',
  'before_response',
  'after_response',
];

const MUTATION_PERMISSIONS = [
  ['permissionBlock', 'block', 'Block'],
  ['permissionPrompt', 'modifyPrompt', 'Modify prompt'],
  ['permissionToolInput', 'modifyToolInput', 'Modify tool input'],
  ['permissionToolOutput', 'modifyToolOutput', 'Modify tool output'],
  ['permissionResponse', 'modifyResponse', 'Modify response'],
] as const;

export function HookCreateModal({
  onClose,
  onCreated,
}: {
  onClose(): void;
  onCreated(): Promise<void>;
}) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const requestClose = () => {
    if (!submitting) onClose();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, submitting]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Object.fromEntries(new FormData(event.currentTarget));
    let args: string[];
    let env: Record<string, string>;
    try {
      args = JSON.parse(String(value.args || '[]'));
      env = JSON.parse(String(value.env || '{}'));
    } catch {
      setError('Hook arguments/environment must be valid JSON');
      return;
    }

    const permissions = ['observe'];
    for (const [field, permission] of MUTATION_PERMISSIONS) {
      if (value[field] === 'on') permissions.push(permission);
    }

    setSubmitting(true);
    setError('');
    try {
      await postJson('/api/hooks', {
        name: value.name,
        event: value.event,
        kind: value.kind,
        execution: value.execution,
        executable: value.executable,
        args,
        env,
        permissions,
        timeoutMs: Number(value.timeoutMs),
        failurePolicy: value.failurePolicy,
        enabled: value.enabled === 'on',
      });
      onClose();
      await onCreated().catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={requestClose}>
      <form
        className="modal hook-create-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hook-create-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <header className="modal-head">
          <div>
            <h2 id="hook-create-title">Create lifecycle hook</h2>
            <p className="muted">Configure when the hook runs and what it may modify.</p>
          </div>
          <button type="button" aria-label="Close" onClick={requestClose} disabled={submitting}>
            ×
          </button>
        </header>

        <div className="modal-body">
          <div className="hook-form">
            <div className="hook-form-main">
              <label className="field">
                <span>Name</span>
                <input name="name" autoFocus required />
              </label>
              <label className="field">
                <span>Event</span>
                <Dropdown
                  name="event"
                  ariaLabel="Hook event"
                  defaultValue="before_tool_call"
                  options={EVENTS.map((value) => ({ value, label: value }))}
                />
              </label>
              <label className="field">
                <span>Kind</span>
                <input name="kind" defaultValue="command" required />
              </label>
              <label className="field hook-executable-field">
                <span>Executable / app</span>
                <input name="executable" required />
              </label>
            </div>

            <div className="hook-form-runtime">
              <label className="field hook-json-field">
                <span>Arguments JSON</span>
                <input name="args" defaultValue="[]" spellCheck={false} />
              </label>
              <label className="field hook-json-field">
                <span>Environment JSON</span>
                <input name="env" defaultValue="{}" spellCheck={false} />
              </label>
              <label className="field">
                <span>Execution</span>
                <Dropdown
                  name="execution"
                  ariaLabel="Hook execution"
                  defaultValue="run"
                  options={[
                    { value: 'run', label: 'Run and wait' },
                    { value: 'launch', label: 'Launch app' },
                  ]}
                />
              </label>
              <label className="field">
                <span>Failure policy</span>
                <Dropdown
                  name="failurePolicy"
                  ariaLabel="Hook failure policy"
                  defaultValue="continue"
                  options={[
                    { value: 'continue', label: 'Continue' },
                    { value: 'block', label: 'Block pre-event' },
                  ]}
                />
              </label>
              <label className="field hook-timeout-field">
                <span>Timeout (ms)</span>
                <input type="number" name="timeoutMs" min={100} max={60000} defaultValue={5000} />
              </label>
            </div>

            <div className="hook-controls">
              <div className="field">
                <span>Permissions</span>
                <div className="hook-permission-grid">
                  {MUTATION_PERMISSIONS.map(([field, , label]) => (
                    <Switch key={field} name={field} label={label} />
                  ))}
                </div>
              </div>
              <div className="field hook-state-field">
                <span>State</span>
                <Switch name="enabled" label="Enabled" defaultChecked />
              </div>
            </div>

            {error ? <p className="inline-result warning-text">{error}</p> : null}
          </div>
        </div>

        <footer className="modal-foot">
          <button type="button" onClick={requestClose} disabled={submitting}>
            Cancel
          </button>
          <button className="primary" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create hook'}
          </button>
        </footer>
      </form>
    </div>
  );
}
