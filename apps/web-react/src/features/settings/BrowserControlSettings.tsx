import { useState } from 'react';
import { requestJson } from '../../services/api-client';
import {
  BrowserOriginPolicy,
  loadOriginPolicy,
  saveOriginPolicy,
  type OriginPolicySnapshot,
} from './BrowserOriginPolicy';

export interface BrowserControlState {
  extensionId: string | null;
  epoch: number;
  pairedAt: string | null;
  pendingCode: boolean;
}

interface PairingCode {
  code: string;
  expiresAt: string;
}

const defaultCreateCode = () =>
  requestJson<PairingCode>('/api/browser/code', { method: 'POST', body: '{}' });
const defaultRevokeAll = () =>
  requestJson<BrowserControlState>('/api/browser/revoke', { method: 'POST', body: '{}' });

export function BrowserControlSettings({
  status,
  onChanged,
  createCode = defaultCreateCode,
  revokeAll = defaultRevokeAll,
  loadPolicy = loadOriginPolicy,
  savePolicy = saveOriginPolicy,
}: {
  status: BrowserControlState;
  onChanged(): Promise<void> | void;
  createCode?: () => Promise<PairingCode>;
  revokeAll?: () => Promise<BrowserControlState>;
  loadPolicy?: () => Promise<OriginPolicySnapshot>;
  savePolicy?: (next: Partial<OriginPolicySnapshot>) => Promise<OriginPolicySnapshot>;
}) {
  const [code, setCode] = useState<PairingCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="panel settings-compact-panel browser-control-panel wide"
      role="region"
      aria-label="Browser control"
    >
      <div className="compact-settings-copy">
        <h3>Browser control</h3>
        <span>
          {status.extensionId ? `Paired extension ${status.extensionId}` : 'No extension paired'}
        </span>
      </div>
      {code ? (
        <p className="inline-result">
          Enter this code in the extension&apos;s options page: <code>{code.code}</code>
        </p>
      ) : null}
      <div className="actions compact-settings-actions">
        <button
          type="button"
          data-surface-id="browser:pair"
          disabled={busy}
          onClick={() => void run(async () => setCode(await createCode()))}
        >
          Pair extension
        </button>
        <button
          type="button"
          className="danger"
          data-surface-id="browser:disconnect-all"
          disabled={busy}
          onClick={() => void run(revokeAll)}
        >
          Disconnect all browsers
        </button>
      </div>
      <p className="section-note compact-settings-note">
        Disconnecting revokes every issued extension token and drops both transports immediately.
      </p>
      {error ? (
        <p role="alert" className="inline-result warning-text">
          {error}
        </p>
      ) : null}
      <BrowserOriginPolicy load={loadPolicy} save={savePolicy} />
    </section>
  );
}
