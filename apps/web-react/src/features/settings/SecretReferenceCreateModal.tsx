import { useState } from 'react';
import { postJson } from './settings-service';
import { SettingsFormModal } from './SettingsFormModal';

export function SecretReferenceCreateModal({
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
    setSubmitting(true);
    setError('');
    try {
      await postJson(
        '/api/secret-references',
        Object.fromEntries(new FormData(event.currentTarget)),
      );
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
      title="Add secret reference"
      description="Store a secret locally and reference it by name from environment profiles."
      submitting={submitting}
      submitLabel="Store securely"
      submittingLabel="Storing…"
      halfWidth
      onClose={onClose}
      onSubmit={submit}
    >
      <div className="settings-modal-fields">
        <label className="field">
          <span>Reference</span>
          <input name="ref" autoFocus required />
        </label>
        <label className="field">
          <span>Secret value</span>
          <input type="password" name="value" autoComplete="new-password" required />
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
