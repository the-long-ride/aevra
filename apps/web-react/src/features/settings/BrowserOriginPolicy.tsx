import { useEffect, useState } from 'react';
import { requestJson } from '../../services/api-client';

export type LoopbackClass = 'BLOCKED' | 'SENSITIVE' | 'NORMAL';

export interface OriginPolicySnapshot {
  loopbackClass: LoopbackClass;
  blockedHosts: string[];
  sensitiveHosts: string[];
  aevraPorts: number[];
}

const LOOPBACK_CHOICES: Array<{ value: LoopbackClass; label: string; hint: string }> = [
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
  const [error, setError] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

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
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const submit = async (loopbackClass: LoopbackClass) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setToast(null);
    try {
      adopt(
        await save({
          loopbackClass,
          blockedHosts: parseHosts(blocked),
          sensitiveHosts: parseHosts(sensitive),
        }),
      );
      setToast('// Origin policy saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!policy) {
    return error ? (
      <p role="alert" className="inline-result warning-text">
        {error}
      </p>
    ) : null;
  }

  return (
    <div className="browser-origin-policy">
      <fieldset className="console-fieldset">
        <legend>Local pages (localhost and 127.0.0.1)</legend>
        <div
          className="console-radio-group"
          role="radiogroup"
          aria-label="Local pages (localhost and 127.0.0.1)"
        >
          {LOOPBACK_CHOICES.map((choice) => {
            const isSelected = policy.loopbackClass === choice.value;
            return (
              <label
                key={choice.value}
                className={`console-radio-option${isSelected ? ' is-selected' : ''}${busy ? ' is-disabled' : ''}`}
              >
                <input
                  type="radio"
                  name="loopbackClass"
                  value={choice.value}
                  checked={isSelected}
                  disabled={busy}
                  onChange={() => void submit(choice.value)}
                />
                <span>{choice.label}</span>
              </label>
            );
          })}
        </div>
        <p className="section-note console-radio-hint">
          {LOOPBACK_CHOICES.find((c) => c.value === policy.loopbackClass)?.hint}
        </p>
      </fieldset>
      <p className="section-note">
        Aevra&apos;s own ports ({policy.aevraPorts.join(', ')}) are always refused. That rule is not
        configurable: it is what stops the agent reaching the surface that grants its capabilities.
      </p>
      <label htmlFor="blockedHosts">Always refuse these hosts</label>
      <input
        id="blockedHosts"
        value={blocked}
        disabled={busy}
        onChange={(event) => setBlocked(event.target.value)}
      />
      <label htmlFor="sensitiveHosts">Always ask before these hosts</label>
      <input
        id="sensitiveHosts"
        value={sensitive}
        disabled={busy}
        onChange={(event) => setSensitive(event.target.value)}
      />
      <p className="section-note">One entry covers that host and every subdomain of it.</p>
      <div className="actions compact-settings-actions">
        <button
          type="button"
          data-surface-id="browser:origin-policy-save"
          disabled={busy}
          onClick={() => void submit(policy.loopbackClass)}
        >
          Save host lists
        </button>
      </div>
      {toast ? (
        <div className="toast-stack">
          <div className="toast success" role="status">
            {toast}
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="inline-result warning-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
