import { useEffect, useState } from 'react';
import { loadBrowserExtensionState } from './browser-extension-service';

/**
 * `unknown` is a real answer, not a loading placeholder that resolves later: a
 * core built without browser control, or one that cannot be reached, leaves us
 * unable to say whether an extension is installed. Suggesting an install in
 * that state would be guessing at the user.
 */
export type BrowserExtensionStatus = 'unknown' | 'paired' | 'missing';

export function useBrowserExtension(): BrowserExtensionStatus {
  const [status, setStatus] = useState<BrowserExtensionStatus>('unknown');

  useEffect(() => {
    const controller = new AbortController();
    loadBrowserExtensionState(controller.signal)
      .then((state) => setStatus(state.extensionId ? 'paired' : 'missing'))
      .catch(() => setStatus('unknown'));
    return () => controller.abort();
  }, []);

  return status;
}
