import { BROWSER_CONTROL_GUIDE_URL, BROWSER_EXTENSION_DOWNLOAD_URL } from '@aevra/admin-contracts';
import { useEffect, useRef } from 'react';

export function BrowserSetupModal({ onClose }: { onClose(): void }) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop browser-setup-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="browser-setup-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Browser control"
        tabIndex={-1}
        ref={panel}
      >
        <h2>Aevra can control your browser</h2>
        <p>
          With the Aevra extension installed, an agent can read pages, click, type, and navigate in
          the browser profile you choose — through the same capability, approval, DLP, and audit
          controls that govern files and commands.
        </p>
        <p className="section-note">
          It stays off until you grant <code>browser.control</code> and pair the extension.
          Password, one-time-code, and payment fields are always refused, and no approval can
          override that.
        </p>
        <div className="actions browser-setup-actions">
          <a
            className="button-link"
            data-surface-id="browser:download-extension"
            href={BROWSER_EXTENSION_DOWNLOAD_URL}
            target="_blank"
            rel="noreferrer"
          >
            Download the extension
          </a>
          {/* Same chapter, served from this machine, so it works offline. */}
          <a
            className="button-link"
            data-surface-id="browser:open-guide"
            href="#guide"
            onClick={onClose}
          >
            Read the setup guide
          </a>
          <button type="button" data-surface-id="browser:suggestion-dismiss" onClick={onClose}>
            Not now
          </button>
        </div>
        <p className="section-note">
          Prefer the published version?{' '}
          <a href={BROWSER_CONTROL_GUIDE_URL} target="_blank" rel="noreferrer">
            Browser control on GitHub
          </a>
          .
        </p>
      </div>
    </div>
  );
}
