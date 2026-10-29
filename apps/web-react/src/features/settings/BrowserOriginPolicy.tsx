import { useEffect, useState } from 'react';
import { SwapControl, type SwapOption } from '../../components/SwapControl';
import { useToast } from '../../components/Toast';
import { requestJson } from '../../services/api-client';

export type LoopbackClass = 'BLOCKED' | 'SENSITIVE' | 'NORMAL';

export interface OriginPolicySnapshot {
  loopbackClass: LoopbackClass;
  blockedHosts: string[];
  sensitiveHosts: string[];
  aevraPorts: number[];
}

const LOOPBACK_CHOICES: SwapOption<LoopbackClass>[] = [
  { value: 'BLOCKED', label: 'Refuse', hint: 'No local page may be driven.' },
  { value: 'SENSITIVE', label: 'Ask every time', hint: 'Each operation needs approval.' },
  { value: 'NORMAL', label: 'Allow', hint: 'Treated like any other site.' },
];

export const loadOriginPolicy = () => requestJson<OriginPolicySnapshot>('/api/browser/policy');

export const saveOriginPolicy = (next: Partial<OriginPolicySnapshot>) =>
  requestJson<OriginPolicySnapshot>('/api/browser/policy', {
    method: 'POST',
    body: JSON.stringify(next),
  });

function parseHosts(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * The operator's half of origin classification. Aevra's own listener ports are
 * shown as a fixed line rather than a control, so the panel states what cannot
 * be changed instead of leaving its absence to be inferred.
 */
export function BrowserOriginPolicy({
  load = loadOriginPolicy,
  save = saveOriginPolicy,
}: {
  load?: () => Promise<OriginPolicySnapshot>;
  save?: (next: Partial<OriginPolicySnapshot>) => Promise<OriginPolicySnapshot>;
}) {
  const [policy, setPolicy] = useState<OriginPolicySnapshot | null>(null);
  const [blocked, setBlocked] = useState('');
  const [sensitive, setSensitive] = useState('');
  const [busy, setBusy] = useState(false);
  const { toast, success, error, clear } = useToast(3000);

  const adopt = (next: OriginPolicySnapshot) => {
    setPolicy(next);
    setBlocked(next.blockedHosts.join(', '));
    setSensitive(next.sensitiveHosts.join(', '));
  };

  useEffect(() => {
    let cancelled = false;
    void load()
      .then((next) => {
        if (!cancelled) adopt(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled) error(cause);
      });
    return () => {
      cancelled = true;
    };
  }, [load, error]);

  const submit = async (loopbackClass: LoopbackClass) => {
    if (busy) return;
    setBusy(true);
    clear();
    try {
      adopt(
        await save({
          loopbackClass,
          blockedHosts: parseHosts(blocked),
          sensitiveHosts: parseHosts(sensitive),
        }),
      );
      success('Origin policy saved.');
    } catch (cause) {
      error(cause);
    } finally {
      setBusy(false);
    }
  };

  if (!policy) return <>{toast}</>;

  return (
    <div className="browser-origin-policy">
      <fieldset className="console-fieldset">
        <legend>Local pages (localhost and 127.0.0.1)</legend>
        <SwapControl
          name="loopbackClass"
          ariaLabel="Local pages (localhost and 127.0.0.1)"
          value={policy.loopbackClass}
          disabled={busy}
          options={LOOPBACK_CHOICES}
          onChange={(val) => void submit(val)}
        />
        <p className="section-note console-radio-hint">
          {LOOPBACK_CHOICES.find((c) => c.value === policy.loopbackClass)?.hint}
        </p>
      </fieldset>
      <p className="section-note">
        Aevra&apos;s own ports ({policy.aevraPorts.join(', ')}) are always refused. That rule is not
        configurable: it is what stops the agent reaching the surface that grants its capabilities.
      </p>
      <div className="browser-origin-hosts-grid">
        <div className="browser-origin-host-field">
          <div className="browser-origin-host-head">
            <label htmlFor="blockedHosts">Always refuse these hosts</label>
            <span className="badge danger">Refuse</span>
          </div>
          <input
            id="blockedHosts"
            value={blocked}
            disabled={busy}
            placeholder="e.g. internal.net, untrusted.org"
            onChange={(event) => setBlocked(event.target.value)}
          />
        </div>
        <div className="browser-origin-host-field">
          <div className="browser-origin-host-head">
            <label htmlFor="sensitiveHosts">Always ask before these hosts</label>
            <span className="badge warning">Ask every time</span>
          </div>
          <input
            id="sensitiveHosts"
            value={sensitive}
            disabled={busy}
            placeholder="e.g. secure.bank.com, admin.corp"
            onChange={(event) => setSensitive(event.target.value)}
          />
        </div>
      </div>
      <p className="section-note">One entry covers that host and every subdomain of it.</p>
      <div className="actions compact-settings-actions">
        <button
          type="button"
          className="primary"
          data-surface-id="browser:origin-policy-save"
          disabled={busy}
          onClick={() => void submit(policy.loopbackClass)}
        >
          Save host lists
        </button>
      </div>
      {toast}
    </div>
  );
}
