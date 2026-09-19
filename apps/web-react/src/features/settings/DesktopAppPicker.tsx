import { memo, useMemo, useState } from 'react';
import { DataTable, type Column } from '../../components/DataTable';
import { useDialog } from '../../components/Dialog';
import { Switch } from '../../components/Switch';
import { AddCustomAppModal } from './AddCustomAppModal';
import type { DetectedApp } from './DesktopControlSettings';

export interface AppRow extends Record<string, unknown> {
  exeBasename: string;
  displayName: string;
  version: string;
  executablePath?: string;
  status: 'Allowed' | 'Blocked';
  allowed: boolean;
  isCustom: boolean;
}

export interface DesktopAppPickerProps {
  applications: string[];
  apps: DetectedApp[];
  busy: boolean;
  onToggleApp: (exeBasename: string, checked: boolean) => void;
  onAddManualApp: (exeBasename: string) => void;
  onSaveCustomApp: (app: DetectedApp, previousExeBasename?: string) => void;
  onDeleteCustomApp: (exeBasename: string) => void;
}

function areArraysEqual(a: string[], b: string[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function DesktopAppPickerComponent({
  applications,
  apps,
  busy,
  onToggleApp,
  onAddManualApp,
  onSaveCustomApp,
  onDeleteCustomApp,
}: DesktopAppPickerProps) {
  const dialog = useDialog();
  const [manual, setManual] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<DetectedApp | null>(null);

  const allowed = useMemo(
    () => new Set(applications.map((entry) => entry.toLowerCase())),
    [applications],
  );

  const isAllowed = (exeBasename: string) => allowed.has(exeBasename.toLowerCase());

  const appRows: AppRow[] = useMemo(() => {
    const knownBasenames = new Set(apps.map((app) => app.exeBasename.toLowerCase()));
    const unlistedAllowed = applications.filter(
      (entry) => !knownBasenames.has(entry.toLowerCase()),
    );

    return [
      ...apps.map((app) => ({
        exeBasename: app.exeBasename,
        displayName: app.displayName,
        version: app.version ?? '—',
        executablePath: app.executablePath,
        status: (allowed.has(app.exeBasename.toLowerCase()) ? 'Allowed' : 'Blocked') as
          'Allowed' | 'Blocked',
        allowed: allowed.has(app.exeBasename.toLowerCase()),
        isCustom: Boolean(app.isCustom),
      })),
      ...unlistedAllowed.map((exeBasename) => ({
        exeBasename,
        displayName: exeBasename,
        version: '—',
        executablePath: exeBasename,
        status: 'Allowed' as const,
        allowed: true,
        isCustom: true,
      })),
    ];
  }, [apps, applications, allowed]);

  const handleOpenAdd = () => {
    setEditingApp(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (row: AppRow) => {
    setEditingApp({
      displayName: row.displayName,
      version: row.version === '—' ? null : row.version,
      executablePath: row.executablePath || row.exeBasename,
      exeBasename: row.exeBasename,
      isCustom: true,
    });
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setEditingApp(null);
  };

  const handleSaveModal = (app: DetectedApp, previousExeBasename?: string) => {
    onSaveCustomApp(app, previousExeBasename);
    handleCloseModal();
  };

  const handleDeleteWithConfirm = async (row: AppRow) => {
    const confirmed = await dialog.confirm({
      title: 'Delete custom app',
      message: `Delete "${row.displayName}" from the custom apps list? This cannot be undone.`,
      confirmLabel: 'Delete',
      confirmTone: 'danger',
    });
    if (!confirmed) return;
    onDeleteCustomApp(row.exeBasename);
  };

  const appColumns: Column<AppRow>[] = useMemo(
    () => [
      {
        key: 'displayName',
        label: 'Application',
        sortable: true,
        search: true,
        render: (row) => (
          <Switch
            checked={row.allowed}
            disabled={busy}
            onChange={(event) => onToggleApp(row.exeBasename, event.currentTarget.checked)}
            containerClassName="desktop-app-table-label"
            label={
              <>
                <span className="desktop-app-name">{row.displayName}</span>
                {row.version !== '—' ? (
                  <small className="desktop-app-version"> v{row.version}</small>
                ) : null}
              </>
            }
          />
        ),
      },
      {
        key: 'exeBasename',
        label: 'Program file',
        sortable: true,
        search: true,
        render: (row) => <code className="desktop-app-exe">{row.exeBasename}</code>,
      },
      {
        key: 'status',
        label: 'Status',
        sortable: true,
        render: (row) => (
          <span className={`desktop-app-status ${row.allowed ? 'is-allowed' : 'is-blocked'}`}>
            {row.status}
          </span>
        ),
      },
      {
        key: 'actions',
        label: 'Actions',
        sortable: false,
        search: false,
        render: (row) =>
          row.isCustom ? (
            <div className="actions desktop-app-row-actions">
              <button
                type="button"
                className="desktop-app-action-btn"
                aria-label={`Edit ${row.displayName}`}
                title="Edit"
                disabled={busy}
                onClick={() => handleOpenEdit(row)}
              >
                Edit
              </button>
              <button
                type="button"
                className="danger-button desktop-app-action-btn"
                aria-label={`Delete ${row.displayName}`}
                title="Delete"
                disabled={busy}
                onClick={() => void handleDeleteWithConfirm(row)}
              >
                [x]
              </button>
            </div>
          ) : (
            <span className="desktop-app-system-badge">—</span>
          ),
      },
    ],
    [busy, onToggleApp, handleDeleteWithConfirm],
  );

  const handleAddManual = () => {
    const entry = manual.trim();
    setManual('');
    if (!entry || isAllowed(entry)) return;
    onAddManualApp(entry);
  };

  return (
    <>
      <div className="desktop-app-picker-table">
        <DataTable
          id="desktop-apps-table"
          rows={appRows}
          columns={appColumns}
          filters={[{ key: 'status', label: 'Status' }]}
          pageSize={10}
          searchPlaceholder="Search apps…"
          emptyText="No apps found."
          rowKey={(row) => row.exeBasename}
        />
      </div>
      <div className="desktop-manual-app-section">
        <div className="desktop-manual-app-header">
          <label htmlFor="desktopManualApp" className="desktop-manual-app-label">
            Add an app by program file name
          </label>
          <button
            type="button"
            className="desktop-custom-app-modal-trigger"
            disabled={busy}
            onClick={handleOpenAdd}
          >
            + Add custom app with path
          </button>
        </div>
        <div className="desktop-manual-app-input-row">
          <input
            id="desktopManualApp"
            value={manual}
            disabled={busy}
            placeholder="Docker Desktop.exe"
            onChange={(event) => setManual(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleAddManual();
              }
            }}
          />
          <button type="button" disabled={busy} onClick={handleAddManual}>
            Add app
          </button>
        </div>
        <p className="section-note">
          Detection only finds apps that register a program file, so some are missing above. Use the
          name the app runs as, not its installer.
        </p>
      </div>
      {modalOpen ? (
        <AddCustomAppModal
          key={editingApp?.exeBasename ?? 'new'}
          open={modalOpen}
          initialApp={editingApp}
          existingExes={applications}
          onClose={handleCloseModal}
          onSave={handleSaveModal}
        />
      ) : null}
    </>
  );
}

export const DesktopAppPicker = memo(
  DesktopAppPickerComponent,
  (prev, next) =>
    prev.busy === next.busy &&
    prev.apps === next.apps &&
    prev.onToggleApp === next.onToggleApp &&
    prev.onAddManualApp === next.onAddManualApp &&
    prev.onSaveCustomApp === next.onSaveCustomApp &&
    prev.onDeleteCustomApp === next.onDeleteCustomApp &&
    areArraysEqual(prev.applications, next.applications),
);
