import { useEffect, type ReactNode } from 'react';

export function SettingsFormModal({
  title,
  description,
  submitting,
  submitLabel,
  submittingLabel,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  description?: string;
  submitting: boolean;
  submitLabel: string;
  submittingLabel: string;
  onClose(): void;
  onSubmit(event: React.FormEvent<HTMLFormElement>): void;
  children: ReactNode;
}) {
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

  const titleId = `settings-modal-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={requestClose}>
      <form
        className="modal settings-form-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={onSubmit}
      >
        <header className="modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p className="muted">{description}</p> : null}
          </div>
          <button type="button" aria-label="Close" onClick={requestClose} disabled={submitting}>
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
        <footer className="modal-foot">
          <button type="button" onClick={requestClose} disabled={submitting}>
            Cancel
          </button>
          <button className="primary" disabled={submitting}>
            {submitting ? submittingLabel : submitLabel}
          </button>
        </footer>
      </form>
    </div>
  );
}
