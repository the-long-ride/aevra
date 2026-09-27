import { useEffect, useState } from 'react';
import { requestJson } from '../../services/api-client';

export type ControlCapability = 'browser.control' | 'desktop.control';
export interface ControlGrants {
  connectionId: string;
  browser: boolean;
  desktop: boolean;
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function useControlGrants(base: string, onChanged: () => Promise<void>) {
  const [grants, setGrants] = useState<ControlGrants | null>(null);
  const [busy, setBusy] = useState<ControlCapability | null>(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    let current = true;
    setGrants(null);
    setLoadError('');
    setActionError('');
    void requestJson<ControlGrants>(base)
      .then((value) => {
        if (current) setGrants(value);
      })
      .catch((cause: unknown) => {
        if (current) setLoadError(message(cause));
      });
    return () => {
      current = false;
    };
  }, [base]);

  const setGrant = async (capability: ControlCapability, enabled: boolean) => {
    if (busy) return;
    setBusy(capability);
    setActionError('');
    try {
      await requestJson(enabled ? base : `${base}/${encodeURIComponent(capability)}`, {
        method: enabled ? 'POST' : 'DELETE',
        ...(enabled ? { body: JSON.stringify({ capability }) } : {}),
      });
      setGrants(await requestJson<ControlGrants>(base));
      await onChanged();
    } catch (cause) {
      const failure = message(cause);
      try {
        // A revoke may be persisted before worker invalidation reports failure.
        setGrants(await requestJson<ControlGrants>(base));
        await onChanged();
        setActionError(failure);
      } catch (refreshCause) {
        setActionError(`${failure}. Could not refresh grants: ${message(refreshCause)}`);
      }
    } finally {
      setBusy(null);
    }
  };

  return { grants, busy, loadError, actionError, setGrant };
}
