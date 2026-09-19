import { useEffect, useState } from 'react';
import { loadBrowserExtensionState } from './browser-extension-service';

/**
 * `unknown` is a real answer, not a loading placeholder that resolves later: a
 * core built without browser control, or one that cannot be reached, leaves us
 * unable to say whether an extension is installed. Suggesting an install in
 * that state would be guessing at the user.
 */
export type BrowserExtensionStatus = 'unknown' | 'paired' | 'missing';

export interface BrowserExtensionInfo {
  status: BrowserExtensionStatus;
  isInstalled: boolean;
  version: string | null;
}

export function useBrowserExtension(): BrowserExtensionStatus {
  const info = useBrowserExtensionInfo();
  return info.status;
}

export function useBrowserExtensionInfo(): BrowserExtensionInfo {
  const [status, setStatus] = useState<BrowserExtensionStatus>('unknown');
  const [localInstalled, setLocalInstalled] = useState<boolean>(() => {
    if (typeof document === 'undefined') return false;
    return document.documentElement.getAttribute('data-aevra-extension-installed') === 'true';
  });
  const [localVersion, setLocalVersion] = useState<string | null>(() => {
    if (typeof document === 'undefined') return null;
    return document.documentElement.getAttribute('data-aevra-extension-version') || null;
  });

  useEffect(() => {
    const controller = new AbortController();
    loadBrowserExtensionState(controller.signal)
      .then((state) => setStatus(state.extensionId ? 'paired' : 'missing'))
      .catch(() => setStatus('unknown'));

    const onDetected = (event: Event) => {
      const custom = event as CustomEvent<{ installed?: boolean; version?: string }>;
      if (custom.detail?.installed) {
        setLocalInstalled(true);
        if (custom.detail.version) setLocalVersion(custom.detail.version);
      }
    };

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'aevra:pong-extension') {
        setLocalInstalled(true);
        if (event.data.version) setLocalVersion(String(event.data.version));
      }
    };

    window.addEventListener('aevra:extension-detected', onDetected);
    window.addEventListener('message', onMessage);

    try {
      window.postMessage({ type: 'aevra:ping-extension' }, '*');
    } catch {
      // Ignore in non-browser env
    }

    if (
      typeof document !== 'undefined' &&
      document.documentElement.getAttribute('data-aevra-extension-installed') === 'true'
    ) {
      setLocalInstalled(true);
      const v = document.documentElement.getAttribute('data-aevra-extension-version');
      if (v) setLocalVersion(v);
    }

    return () => {
      controller.abort();
      window.removeEventListener('aevra:extension-detected', onDetected);
      window.removeEventListener('message', onMessage);
    };
  }, []);

  const isInstalled = localInstalled || status === 'paired';

  return {
    status,
    isInstalled,
    version: localVersion,
  };
}
