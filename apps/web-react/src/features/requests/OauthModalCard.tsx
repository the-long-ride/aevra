import type { OauthRequestItem } from '@aevra/admin-contracts';
import { useState } from 'react';
import { Switch } from '../../components/Switch';
import { useToast } from '../../components/Toast';
import { decideOauth } from './requests-service';

export function OauthModalCard({
  item,
  onActioned,
}: {
  item: OauthRequestItem;
  onActioned(): Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const { toast, error: showError } = useToast();
  const [keepSignedIn, setKeepSignedIn] = useState(true);

  const decide = async (allow: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await decideOauth(item.id, allow, { renewable: keepSignedIn });
      await onActioned();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'The decision could not be recorded.';
      const isTerminalOrStale = /expired|timeout|not found|already|invalid_state/i.test(message);
      if (isTerminalOrStale) {
        await onActioned();
        return;
      }
      showError(message);
      setBusy(false);
    }
  };

  return (
    <>
      <div className="approval-modal-head">
        <div>
          <b>OAuth connection</b>
          <span>{item.clientName ?? item.clientId}</span>
        </div>
        <span className="risk medium">MEDIUM</span>
      </div>
      <p className="approval-modal-detail">
        {item.remoteIp ?? 'Remote client'} · code <code>{item.pairingCode}</code>
      </p>
      <p className="approval-modal-detail">
        Redirect origin: <code>{item.redirectOrigin ?? 'Unavailable'}</code>
      </p>
      <p className="approval-modal-detail">
        Client ID: <code>{item.clientId ?? 'Unavailable'}</code>
      </p>
      {item.duplicateClientName ? (
        <p role="alert">
          Another OAuth client uses the same name. Verify the redirect origin and client ID before
          allowing.
        </p>
      ) : null}
      <div className="approval-modal-option-row">
        <Switch
          checked={keepSignedIn}
          onChange={(e) => setKeepSignedIn(e.target.checked)}
          data-surface-id="approval-modal:oauth-renewable"
          containerClassName="approval-modal-option-label"
          label={
            <div className="approval-modal-option-info">
              <span className="approval-modal-option-title">Keep this connection signed in</span>
              <span className="approval-modal-option-description">
                Issue a refresh token for continued access beyond 1 hour.
              </span>
            </div>
          }
        />
      </div>
      <div className="request-actions approval-modal-actions">
        <button
          type="button"
          data-surface-id="approval-modal:oauth-deny"
          disabled={busy}
          onClick={() => void decide(false)}
        >
          Deny
        </button>
        <button
          type="button"
          className="primary"
          data-surface-id="approval-modal:oauth-allow"
          disabled={busy}
          onClick={() => void decide(true)}
        >
          Allow
        </button>
      </div>
      {toast}
    </>
  );
}
