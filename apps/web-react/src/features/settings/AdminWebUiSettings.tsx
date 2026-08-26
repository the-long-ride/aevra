export interface AdminProbeState {
  tone: 'success' | 'warning' | 'error';
  message: string;
}

export function AdminWebUiSettings({
  adminPublicUrl,
  adminProbe,
  trustedAdminOrigins,
  newTrustedAdminOrigin,
  onAdminPublicUrlChange,
  onTest,
  onNewTrustedOriginChange,
  onAddTrustedOrigin,
  onRemoveTrustedOrigin,
}: {
  adminPublicUrl: string;
  adminProbe: AdminProbeState | null;
  trustedAdminOrigins: string[];
  newTrustedAdminOrigin: string;
  onAdminPublicUrlChange(value: string): void;
  onTest(): void;
  onNewTrustedOriginChange(value: string): void;
  onAddTrustedOrigin(): void;
  onRemoveTrustedOrigin(index: number): void;
}) {
  return (
    <section className="remote-config-section remote-admin-config">
      <div className="remote-config-section-head">
        <div>
          <h4>Administration Web UI</h4>
          <p>
            Configure the public Admin URL and any additional browser origins allowed to use it.
          </p>
        </div>
      </div>
      <div className="remote-admin-layout">
        <div className="remote-admin-url-control">
          <div className="remote-admin-label-row">
            <label htmlFor="admin-public-url">Admin public URL</label>
            {adminPublicUrl.trim() ? <span className="remote-origin-badge">Primary</span> : null}
          </div>
          <div className="remote-admin-url-row">
            <input
              id="admin-public-url"
              name="adminPublicUrl"
              value={adminPublicUrl}
              onChange={(event) => onAdminPublicUrlChange(event.target.value)}
              placeholder="https://aevra-ui.example.com"
            />
            <button type="button" onClick={onTest}>
              Test Admin URL
            </button>
          </div>
          <div className="remote-admin-meta">
            <span className="field-help">
              Canonical URL used to open the Administration Web UI.
            </span>
            {adminProbe ? (
              <span className={`remote-admin-probe ${adminProbe.tone}`}>{adminProbe.message}</span>
            ) : null}
          </div>
        </div>

        <div className="field remote-trusted-origins">
          <span>Trusted Admin origins</span>
          <small className="field-help">
            Additional exact HTTPS origins allowed to send Admin login and mutation requests.
          </small>
          <div className="trusted-origin-list">
            {trustedAdminOrigins.map((origin, index) => (
              <div className="trusted-origin-row" key={`${origin}-${index}`}>
                <code>{origin}</code>
                <button
                  type="button"
                  className="trusted-origin-remove"
                  aria-label={`Remove trusted origin ${origin}`}
                  title="Remove trusted origin"
                  onClick={() => onRemoveTrustedOrigin(index)}
                >
                  ×
                </button>
              </div>
            ))}
            {trustedAdminOrigins.length === 0 ? (
              <span className="trusted-origin-empty">No additional trusted origins.</span>
            ) : null}
          </div>
          <div className="trusted-origin-add">
            <input
              aria-label="New trusted Admin origin"
              value={newTrustedAdminOrigin}
              onChange={(event) => onNewTrustedOriginChange(event.target.value)}
              placeholder="https://admin.example.com"
            />
            <button type="button" onClick={onAddTrustedOrigin}>
              Add trusted origin
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
