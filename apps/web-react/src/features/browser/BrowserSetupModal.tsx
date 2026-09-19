import {
  BROWSER_CONTROL_GUIDE_URL,
  BROWSER_EXTENSION_DOWNLOAD_URL,
  browserExtensionZipUrl,
} from '@aevra/admin-contracts';
import { useEffect, useRef } from 'react';
import { useBrowserExtensionInfo } from './use-browser-extension';

export function BrowserSetupModal({
  onClose,
  aevraVersion,
}: {
  onClose(): void;
  aevraVersion?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const { isInstalled, version: extVersion } = useBrowserExtensionInfo();

  useEffect(() => {
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cleanAevra = (aevraVersion ?? '').replace(/^v/, '').trim();
  const cleanExt = (extVersion ?? '').replace(/^v/, '').trim();
  const isMismatch = Boolean(isInstalled && cleanExt && cleanAevra && cleanExt !== cleanAevra);
  const downloadUrl = cleanAevra
    ? browserExtensionZipUrl(cleanAevra)
    : BROWSER_EXTENSION_DOWNLOAD_URL;

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
        {isMismatch ? (
          <div
            className="extension-mismatch-banner"
            style={{
              padding: '10px 12px',
              border: '1px solid var(--warning, #e6a23c)',
              background: 'rgba(230, 162, 60, 0.1)',
              borderRadius: '4px',
              marginBottom: '12px',
            }}
          >
            <strong style={{ color: 'var(--warning, #e6a23c)' }}>
              Extension version mismatch detected
            </strong>
            <p style={{ margin: '4px 0 0', fontSize: '13px' }}>
              Your browser extension is <strong>v{cleanExt}</strong>, but Aevra is{' '}
              <strong>v{cleanAevra}</strong>. We recommend downloading and reloading the matching
              browser extension to ensure full compatibility.
            </p>
          </div>
        ) : null}
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
            href={downloadUrl}
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
