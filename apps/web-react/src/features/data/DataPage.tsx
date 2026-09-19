import { useEffect, useRef, useState } from 'react';
import { Switch } from '../../components/Switch';
import {
  downloadBackupFile,
  fetchAllDataForBackup,
  importAllData,
  inspectBackup,
  parseAndValidateBackup,
  readFileAsText,
  type AevraBackupData,
  type ImportPreviewSummary,
} from './data-service';

export function DataPage() {
  const [portable, setPortable] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pendingBackup, setPendingBackup] = useState<AevraBackupData | null>(null);
  const [previewSummary, setPreviewSummary] = useState<ImportPreviewSummary | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const resetImport = () => {
    setPendingBackup(null);
    setPreviewSummary(null);
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const handleBackup = async () => {
    if (backingUp) return;
    setBackingUp(true);
    setError('');
    setSuccess('');
    try {
      const data = await fetchAllDataForBackup(portable);
      downloadBackupFile(data);
      setToast('// Backup downloaded successfully.');
      setSuccess('Backup file generated and downloaded successfully.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBackingUp(false);
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    setError('');
    setSuccess('');
    const file = event.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    try {
      const text = await readFileAsText(file);
      const parsed = parseAndValidateBackup(text);
      setPendingBackup(parsed);
      setPreviewSummary(inspectBackup(parsed));
    } catch (cause) {
      setPendingBackup(null);
      setPreviewSummary(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const handleImport = async () => {
    if (!pendingBackup || importing) return;
    setImporting(true);
    setError('');
    setSuccess('');
    try {
      const result = await importAllData(pendingBackup);
      setToast('// Data imported successfully.');
      setSuccess(
        `Import complete: ${result.workspaces} workspace(s), ${result.rules} permission rule(s), ${result.customApps} custom app(s) restored.`,
      );
      resetImport();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setImporting(false);
    }
  };

  const handleCancelImport = () => {
    resetImport();
  };

  return (
    <>
      <section className="page-head data-page-head">
        <div>
          <h2>Data</h2>
          <p>
            Backup and import workspaces, permissions, policies, custom apps, and configuration
            data.
          </p>
        </div>
      </section>
      <div className="settings-grid settings-grid-compact data-grid">
        <section className="panel settings-compact-panel data-panel" aria-label="Backup all data">
          <div className="panel-head compact-panel-head">
            <div>
              <h3>Backup all data</h3>
              <p>Download a snapshot of your Aevra configuration, workspaces, and rules.</p>
            </div>
          </div>
          <div className="data-panel-body">
            <Switch
              label={<span>Portable mode (strip machine-specific filesystem paths)</span>}
              checked={portable}
              disabled={backingUp}
              onChange={(e) => setPortable(e.target.checked)}
              containerClassName="data-checkbox-label"
            />
            <div className="data-security-notice">
              <code>
                // Notice: Device-only environment variables and local secrets are excluded from
                backups.
              </code>
            </div>
          </div>
          <div className="actions compact-settings-actions">
            <button
              type="button"
              disabled={backingUp}
              onClick={handleBackup}
              data-surface-id="data:backup"
            >
              {backingUp ? 'Generating backup…' : 'Download backup (.json)'}
            </button>
          </div>
        </section>

        <section className="panel settings-compact-panel data-panel" aria-label="Import data">
          <div className="panel-head compact-panel-head">
            <div>
              <h3>Import data</h3>
              <p>Restore or migrate workspaces, permissions, and policies from a backup file.</p>
            </div>
          </div>
          <div className="data-panel-body">
            <div className="data-file-row">
              <input
                type="file"
                ref={fileInputRef}
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              <button
                type="button"
                disabled={importing}
                onClick={() => fileInputRef.current?.click()}
              >
                Select backup file…
              </button>
              <span className="data-selected-file-name">
                {selectedFile ? selectedFile.name : 'No file chosen'}
              </span>
            </div>

            {previewSummary ? (
              <div className="data-import-preview">
                <h4>Backup preview</h4>
                <dl className="data-preview-stats">
                  <div className="data-stat-row">
                    <dt>Workspaces:</dt>
                    <dd>{previewSummary.workspacesCount}</dd>
                  </div>
                  <div className="data-stat-row">
                    <dt>Mounts:</dt>
                    <dd>{previewSummary.mountsCount}</dd>
                  </div>
                  <div className="data-stat-row">
                    <dt>Permission rules:</dt>
                    <dd>{previewSummary.rulesCount}</dd>
                  </div>
                  <div className="data-stat-row">
                    <dt>Capability profiles:</dt>
                    <dd>{previewSummary.profilesCount}</dd>
                  </div>
                  <div className="data-stat-row">
                    <dt>Custom apps:</dt>
                    <dd>{previewSummary.customAppsCount}</dd>
                  </div>
                  <div className="data-stat-row">
                    <dt>Type:</dt>
                    <dd>{previewSummary.portable ? 'Portable' : 'Local system'}</dd>
                  </div>
                </dl>
                <div className="data-security-notice">
                  <code>// {previewSummary.securityNotice}</code>
                </div>
              </div>
            ) : null}
          </div>
          <div className="actions compact-settings-actions">
            {previewSummary ? (
              <>
                <button
                  type="button"
                  disabled={importing}
                  onClick={handleImport}
                  data-surface-id="data:import"
                >
                  {importing ? 'Importing…' : 'Confirm & import data'}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={importing}
                  onClick={handleCancelImport}
                >
                  Cancel
                </button>
              </>
            ) : null}
          </div>
        </section>
      </div>

      {success ? <p className="inline-result data-success-banner">{success}</p> : null}
      {error ? (
        <p role="alert" className="inline-result warning-text">
          {error}
        </p>
      ) : null}

      {toast ? (
        <div className="toast-stack">
          <div className="toast success" role="status">
            {toast}
          </div>
        </div>
      ) : null}
    </>
  );
}
