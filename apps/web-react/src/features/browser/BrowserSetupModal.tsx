import { BROWSER_EXTENSION_DOWNLOAD_URL, browserExtensionZipUrl } from '@aevra/admin-contracts';
import { useEffect, useRef, useState } from 'react';
import { requestJson } from '../../services/api-client';
import { useBrowserExtensionInfo } from './use-browser-extension';

interface PairingCodeResponse {
  code: string;
  expiresAt: string;
}

const defaultCreateCode = () =>
  requestJson<PairingCodeResponse>('/api/browser/code', {
    method: 'POST',
    body: '{}',
  });

export function BrowserSetupModal({
  onClose,
  aevraVersion,
  createCode = defaultCreateCode,
}: {
  onClose(): void;
  aevraVersion?: string;
  createCode?: () => Promise<PairingCodeResponse>;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const { status, isInstalled, version: extVersion } = useBrowserExtensionInfo();

  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);

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

  const handleGeneratePairingCode = async () => {
    if (generatingCode) return;
    setGeneratingCode(true);
    setPairingError(null);
    try {
      const res = await createCode();
      setPairingCode(res.code);
    } catch (err) {
      setPairingError(err instanceof Error ? err.message : String(err));
    } finally {
      setGeneratingCode(false);
    }
  };

  const handleCopyCode = async () => {
    if (!pairingCode) return;
    try {
      await navigator.clipboard.writeText(pairingCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // Ignore clipboard error
    }
  };

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
        <header className="browser-setup-header">
          <h2>Aevra can control your browser</h2>
          <p className="browser-modal-subtitle">
            Safely drive browser navigation, form interaction, and testing under explicit security
            controls.
          </p>
        </header>

        {isMismatch ? (
          <div className="extension-mismatch-banner" role="alert">
            <div className="mismatch-badge">Extension version mismatch detected</div>
            <p>
              Your browser extension is <strong>v{cleanExt}</strong>, but Aevra is{' '}
              <strong>v{cleanAevra}</strong>. We recommend downloading and reloading the matching
              browser extension to ensure full compatibility.
            </p>
          </div>
        ) : null}

        <div className="browser-highlights-grid">
          <div className="browser-highlight-item">
            <span className="highlight-tag">DLP &amp; Privacy</span>
            <p>
              Password, one-time-code (OTP), and payment fields are unconditionally refused by the
              extension. No approval can override this.
            </p>
          </div>
          <div className="browser-highlight-item">
            <span className="highlight-tag">Explicit Authority</span>
            <p>
              Automation remains completely disabled until you grant <code>browser.control</code>{' '}
              and pair this browser.
            </p>
          </div>
          <div className="browser-highlight-item">
            <span className="highlight-tag">Audit &amp; Controls</span>
            <p>
              Reads, clicks, inputs, and navigation are subject to the same approval, capability,
              and audit logs as shell commands.
            </p>
          </div>
        </div>

        <section className="browser-modal-pairing-section">
          {status === 'paired' ? (
            <div className="browser-pairing-status paired" data-surface-id="browser:paired-state">
              <span className="pairing-status-dot" />
              <span>Browser extension is paired and connected.</span>
            </div>
          ) : pairingCode ? (
            <div className="browser-pairing-code-box" data-surface-id="browser:pairing-active">
              <span className="pairing-code-title">
                Enter this code in your extension popup or options:
              </span>
              <div className="browser-code-row">
                <code className="browser-code-display">{pairingCode}</code>
                <button
                  type="button"
                  className="browser-copy-code-btn"
                  data-surface-id="browser:copy-pairing-code"
                  onClick={handleCopyCode}
                >
                  {copiedCode ? 'Copied!' : 'Copy code'}
                </button>
              </div>
              <small className="pairing-code-expiry">Code expires in 5 minutes.</small>
            </div>
          ) : (
            <div className="browser-pair-action-row">
              <button
                type="button"
                className="button-link browser-pair-trigger-btn"
                data-surface-id="browser:pair"
                disabled={generatingCode}
                onClick={handleGeneratePairingCode}
              >
                {generatingCode ? 'Generating code…' : 'Pair extension'}
              </button>
              <span className="browser-pair-hint">
                Generate a secure one-time code to link your browser extension directly.
              </span>
            </div>
          )}

          {pairingError ? (
            <p role="alert" className="browser-pairing-error">
              {pairingError}
            </p>
          ) : null}
        </section>

        <div className="actions browser-setup-actions">
          <a
            className="button-link primary-action"
            data-surface-id="browser:download-extension"
            href={downloadUrl}
            target="_blank"
            rel="noreferrer"
          >
            Download the extension
          </a>
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
      </div>
    </div>
  );
}
