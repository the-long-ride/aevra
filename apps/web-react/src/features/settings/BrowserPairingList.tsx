import type { BrowserPairingRow } from './BrowserControlSettings';

function shortProfileId(profileId: string | null): string {
  return profileId ? profileId.slice(0, 8) : 'Legacy pairing';
}

function pairedDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}

export function BrowserPairingList({
  pairings,
  busy,
  unpairingId,
  rowErrors,
  onUnpair,
}: {
  pairings: BrowserPairingRow[];
  busy: boolean;
  unpairingId: string | null;
  rowErrors: Record<string, string>;
  onUnpair(pairing: BrowserPairingRow): void;
}) {
  return (
    <ul className="browser-pairing-list" aria-label="Paired browser profiles">
      {pairings.map((pairing) => {
        const label = pairing.profileName || shortProfileId(pairing.profileId);
        const rowBusy = unpairingId === pairing.pairingId;
        return (
          <li className="browser-pairing-row" key={pairing.pairingId}>
            <div className="browser-pairing-details">
              <div className="browser-pairing-heading">
                <strong>{label}</strong>
                <span
                  className={
                    pairing.connected ? 'browser-pairing-state active' : 'browser-pairing-state'
                  }
                >
                  {pairing.connected ? 'Active browser socket' : 'Paired, offline'}
                </span>
              </div>
              <dl>
                <div>
                  <dt>Profile ID</dt>
                  <dd>
                    <code>{shortProfileId(pairing.profileId)}</code>
                  </dd>
                </div>
                <div>
                  <dt>Extension ID</dt>
                  <dd>
                    <code>{pairing.extensionId}</code>
                  </dd>
                </div>
                <div>
                  <dt>Paired</dt>
                  <dd>{pairedDate(pairing.pairedAt)}</dd>
                </div>
              </dl>
              {rowErrors[pairing.pairingId] ? (
                <p role="alert" className="inline-result warning-text browser-pairing-row-error">
                  {rowErrors[pairing.pairingId]}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="danger browser-pairing-unpair"
              data-surface-id="browser:unpair"
              disabled={busy}
              aria-label={`Unpair ${label}`}
              onClick={() => {
                if (
                  window.confirm(`Unpair ${label}? This browser profile will need to pair again.`)
                ) {
                  onUnpair(pairing);
                }
              }}
            >
              {rowBusy ? 'Unpairing…' : 'Unpair'}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
