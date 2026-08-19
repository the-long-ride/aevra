import type { CloudflareStatus } from '@aevra/admin-contracts';
import { RemoteAccessPanel } from '../dashboard/RemoteAccessPanel';
import { postJson } from './settings-service';

export function RemoteAccessSettings({
  status,
  onChanged,
}: {
  status: CloudflareStatus;
  onChanged(): Promise<void>;
}) {
  const submitAccess = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!status.hostname) return;
    const value = Object.fromEntries(new FormData(event.currentTarget));
    await postJson('/api/cloudflare/setup', {
      ...value,
      hostname: status.hostname,
      tunnelId: status.tunnelId,
      ownership: status.ownership,
    });
    await onChanged();
  };

  return (
    <section className="panel remote-card">
      <div className="panel-head">
        <h3>Remote Access</h3>
      </div>
      <RemoteAccessPanel status={status} onChanged={onChanged} />
      <details className="advanced-access">
        <summary>Cloudflare Access verifier</summary>
        <form className="form-row" onSubmit={submitAccess}>
          <label className="field">
            <span>Mode</span>
            <select name="authMode" defaultValue={status.authMode ?? 'connector'}>
              <option value="connector">Aevra OAuth only</option>
              <option value="access">Cloudflare Access plus Aevra</option>
            </select>
          </label>
          <label className="field">
            <span>Access issuer</span>
            <input name="issuer" defaultValue={status.issuer ?? ''} />
          </label>
          <label className="field">
            <span>Audience</span>
            <input name="audience" defaultValue={status.audience ?? ''} />
          </label>
          <button data-surface-id="settings:save-access-mode">Save Access mode</button>
        </form>
      </details>
    </section>
  );
}
