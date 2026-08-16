import { useEffect, useState } from 'react';
import { requestJson } from '../../services/api-client';

export function ConnectorModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose(): void;
  onCreated(): Promise<void>;
}) {
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open) {
      setName('');
      setToken('');
      setError('');
    }
  }, [open]);

  if (!open) return null;

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      const created = await requestJson<{ token: string }>('/api/connectors', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() }),
      });
      setToken(created.token);
      setError('');
      await onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connector-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <h2 id="connector-modal-title">Create Bearer connector</h2>
            <p className="muted">
              OAuth is preferred. Use a fixed Bearer token only when the client requires it.
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-body">
          {token ? (
            <div className="secret-result">
              <b>Copy this token now. It is shown once.</b>
              <code>{token}</code>
              <button type="button" onClick={() => void navigator.clipboard.writeText(token)}>
                Copy token
              </button>
            </div>
          ) : (
            <form className="stack-form" onSubmit={create}>
              <label className="field">
                <span>Connector name</span>
                <input
                  placeholder="Connector name"
                  value={name}
                  onChange={(event) => setName(event.currentTarget.value)}
                  required
                />
              </label>
              {error ? <p className="warning">{error}</p> : null}
              <button className="primary" data-surface-id="connections:create-connector">
                Create token
              </button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
