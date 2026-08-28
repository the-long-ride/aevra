import { useState } from 'react';
import { postJson } from './settings-service';
import { SettingsFormModal } from './SettingsFormModal';

export function EnvironmentProfileCreateModal({
  onClose,
  onCreated,
}: {
  onClose(): void;
  onCreated(): Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Object.fromEntries(new FormData(event.currentTarget));
    let vars: unknown;
    let secretRefs: unknown;
    try {
      vars = JSON.parse(String(value.vars || '{}'));
      secretRefs = JSON.parse(String(value.secretRefs || '{}'));
      if (!vars || Array.isArray(vars) || typeof vars !== 'object') throw new Error();
      if (!secretRefs || Array.isArray(secretRefs) || typeof secretRefs !== 'object')
        throw new Error();
    } catch {
      setError('Variables and secret references must be valid JSON objects.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await postJson('/api/environment-profiles', { name: value.name, vars, secretRefs });
      onClose();
      await onCreated().catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SettingsFormModal
      title="Create environment profile"
      description="Define reusable environment variables and references to locally stored secrets."
      submitting={submitting}
      submitLabel="Create profile"
      submittingLabel="Creating…"
      halfWidth
      onClose={onClose}
      onSubmit={submit}
    >
      <div className="settings-modal-fields">
        <label className="field">
          <span>Name</span>
          <input name="name" autoFocus required />
        </label>
        <label className="field settings-json-field">
          <span>Variables JSON</span>
          <textarea name="vars" defaultValue="{}" spellCheck={false} />
        </label>
        <label className="field settings-json-field">
          <span>Secret refs JSON</span>
          <textarea name="secretRefs" defaultValue="{}" spellCheck={false} />
        </label>
        {error ? (
          <p role="alert" className="inline-result warning-text">
            {error}
          </p>
        ) : null}
      </div>
    </SettingsFormModal>
  );
}
