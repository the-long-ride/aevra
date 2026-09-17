import { useState } from 'react';
import { BrowserSetupModal } from './BrowserSetupModal';
import { useBrowserExtension } from './use-browser-extension';

/**
 * Sits immediately left of Requests in the top bar, and only while Aevra can
 * see that no extension is paired. A paired browser gets nothing, and neither
 * does a core that cannot answer - a permanent badge in the shell would be an
 * advert rather than a prompt.
 */
export function BrowserSuggestion() {
  const status = useBrowserExtension();
  const [open, setOpen] = useState(false);

  if (status !== 'missing') return null;

  return (
    <>
      <button
        type="button"
        className="browser-suggestion"
        data-surface-id="browser:suggestion"
        aria-label="Aevra can control your browser"
        title="Aevra can control your browser"
        onClick={() => setOpen(true)}
      >
        Browser
      </button>
      {open ? <BrowserSetupModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}
