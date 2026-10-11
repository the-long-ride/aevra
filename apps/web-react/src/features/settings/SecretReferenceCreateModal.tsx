import { useState } from 'react';
import { useToast } from '../../components/Toast';
import { postJson } from './settings-service';
import { SettingsFormModal } from './SettingsFormModal';

export function SecretReferenceCreateModal({
  reference,
  onClose,
  onCreated,
}: {
  reference?: string | undefined;
  onClose(): void;
  onCreated(): Promise<void>;
}) {
  const editing = reference !== undefined;
  const [submitting, setSubmitting] = useState(false);
  const { toast, error } = useToast();

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await postJson(
        '/api/secret-references',
        Object.fromEntries(new FormData(event.currentTarget)),
      );
      onClose();
      await onCreated().catch(() => undefined);
    } catch (cause) {
      error(cause);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <SettingsFormModal
        title={editing ? 'Update secret value' : 'Add secret reference'}
        description={
          editing
            ? 'Replace the stored value. The current value is never shown.'
            : 'Store a secret locally and reference it by name from environment profiles.'
        }
        submitting={submitting}
        submitLabel={editing ? 'Update secret' : 'Store securely'}
        submittingLabel={editing ? 'Updating…' : 'Storing…'}
        halfWidth
        onClose={onClose}
        onSubmit={submit}
      >
        <div className="settings-modal-fields">
          <label className="field">
            <span>Reference</span>
            <input
              name="ref"
              defaultValue={reference}
              readOnly={editing}
              autoFocus={!editing}
              required
            />
          </label>
          <label className="field">
            <span>Secret value</span>
            <input
              type="password"
              name="value"
              autoComplete="new-password"
              autoFocus={editing}
              required
            />
          </label>
        </div>
      </SettingsFormModal>
      {toast}
    </>
  );
}
