import { useState } from 'react';
import type { BrowserControlSnapshot, BrowserPairingRecord } from '@aevra/admin-contracts';
import { requestJson } from '../../services/api-client';
import {
  BrowserOriginPolicy,
  loadOriginPolicy,
  saveOriginPolicy,
  type OriginPolicySnapshot,
} from './BrowserOriginPolicy';
import { BrowserPairingList } from './BrowserPairingList';

export type BrowserPairingRow = BrowserPairingRecord;
export type BrowserControlState = Omit<BrowserControlSnapshot, 'pairings'> & {
  pairings?: BrowserPairingRecord[];
};

interface PairingCode {
  code: string;
  expiresAt: string;
}

const defaultCreateCode = () =>
  requestJson<PairingCode>('/api/browser/code', { method: 'POST', body: '{}' });
const defaultRevokeAll = () =>
  requestJson<BrowserControlState>('/api/browser/revoke', { method: 'POST', body: '{}' });
const defaultUnpair = (pairingId: string) =>
  requestJson<BrowserControlState>(`/api/browser/pairings/${encodeURIComponent(pairingId)}`, {
    method: 'DELETE',
  });

export function BrowserControlSettings({
  status,
  onChanged,
  createCode = defaultCreateCode,
  revokeAll = defaultRevokeAll,
  unpair = defaultUnpair,
  loadPolicy = loadOriginPolicy,
  savePolicy = saveOriginPolicy,
}: {
  status: BrowserControlState;
  onChanged(): Promise<void> | void;
  createCode?: () => Promise<PairingCode>;
  revokeAll?: () => Promise<BrowserControlState>;
  unpair?: (pairingId: string) => Promise<BrowserControlState>;
  loadPolicy?: () => Promise<OriginPolicySnapshot>;
  savePolicy?: (next: Partial<OriginPolicySnapshot>) => Promise<OriginPolicySnapshot>;
}) {
  const [code, setCode] = useState<PairingCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [unpairingId, setUnpairingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const pairings = status.pairings ?? [];
  const mutating = busy || unpairingId !== null;

  const run = async (action: () => Promise<unknown>) => {
    if (mutating) return;
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

  const removePairing = async (pairing: BrowserPairingRow) => {
    if (mutating) return;
    setUnpairingId(pairing.pairingId);
    setRowErrors((current) => {
      const next = { ...current };
      delete next[pairing.pairingId];
      return next;
    });
    try {
      await unpair(pairing.pairingId);
      await onChanged();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setRowErrors((current) => ({
        ...current,
        [pairing.pairingId]: message,
      }));
      setError(`Unpair request needs attention: ${message}`);
      // Core persists unpair before worker synchronization. Refresh even on a
      // pending-sync response so the visible list reflects that source of truth.
      try {
        await onChanged();
      } catch {
        // Keep the row error visible if the refresh also fails.
      }
    } finally {
      setUnpairingId(null);
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
          {pairings.length === 0
            ? 'No browser profiles paired'
            : `${pairings.length} browser profile${pairings.length === 1 ? '' : 's'} paired`}
        </span>
      </div>
      {status.health ? (
        <p className="section-note" role="status">
          {status.health.worker?.listener.state === 'failed'
            ? `Listener failed on port ${status.health.worker.listener.port}: ${status.health.worker.listener.errorCode ?? 'BROWSER_LISTENER_FAILED'}. Close the other app using this port, then retry.`
            : !status.health.worker
              ? `Worker unavailable: ${status.health.syncErrorCode ?? 'WORKER_UNAVAILABLE'}. Start or restart Aevra, then retry.`
              : status.health.syncErrorCode
                ? `Pairing sync needs attention: ${status.health.syncErrorCode}. Retry connection.`
                : status.health.worker.extensionSocketAuthenticated
                  ? `Extension socket authenticated${status.health.worker.activeProfileName ? ` for ${status.health.worker.activeProfileName}` : ''}`
                  : pairings.length > 0
                    ? 'Waiting for a paired profile to authenticate. Open the extension; if it remains offline, pair again.'
                    : 'No extension socket authenticated'}
          {status.health.worker?.connected
            ? ' - Browser attached'
            : status.health.worker?.extensionSocketAuthenticated
              ? ' - Browser not attached. Ask an authorized AI connection to call browser_connect with transport extension.'
              : ' - No browser attached'}
        </p>
      ) : null}
      <p className="section-note">
        Grant browser control to an exact AI connection in Dashboard connection details. Workspace
        access does not grant browser control.
      </p>

      {pairings.length > 0 ? (
        <BrowserPairingList
          pairings={pairings}
          busy={mutating}
          unpairingId={unpairingId}
          rowErrors={rowErrors}
          onUnpair={(pairing) => void removePairing(pairing)}
        />
      ) : (
        <p className="browser-pairing-empty" role="status">
          Pair a browser profile to let an authorized AI connection control its tabs.
        </p>
      )}

      {code ? (
        <p className="inline-result">
          Enter this code in the extension&apos;s options page: <code>{code.code}</code>
        </p>
      ) : null}
      <div className="actions compact-settings-actions">
        <button
          type="button"
          data-surface-id="browser:pair"
          disabled={mutating}
          onClick={() => void run(async () => setCode(await createCode()))}
        >
          Pair extension
        </button>
        <button
          type="button"
          className="danger"
          data-surface-id="browser:disconnect-all"
          disabled={mutating}
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
