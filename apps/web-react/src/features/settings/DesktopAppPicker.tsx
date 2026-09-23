import { memo, useMemo, useState } from 'react';
import { DataTable, type Column } from '../../components/DataTable';
import { useDialog } from '../../components/Dialog';
import { Switch } from '../../components/Switch';
import { AddCustomAppModal } from './AddCustomAppModal';
import type { AppCatalogRow, DetectedApp } from './DesktopControlSettings';

export interface AppRow extends Record<string, unknown> {
  rowId: string;
  exeBasename: string;
  displayName: string;
  version: string;
  sources: string;
  executablePath?: string;
  status: 'Allowed' | 'Blocked' | 'Needs manual path' | 'Shared runtime';
  allowed: boolean;
  grantable: boolean;
  isCustom: boolean;
  grantId?: string;
  customAppId?: string;
}

export interface DesktopAppPickerProps {
  applications: string[];
  apps: AppCatalogRow[];
  busy: boolean;
  onToggleApp: (exeBasename: string, checked: boolean, row?: AppRow) => void;
  onAddManualApp: (exeBasename: string) => void;
  onSaveCustomApp: (app: DetectedApp, previousExeBasename?: string, customAppId?: string) => void;
  onDeleteCustomApp: (exeBasename: string, customAppId?: string) => void;
}

function areArraysEqual(a: string[], b: string[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function isWebViewRuntime(value: string): boolean {
  return value.split(/[\\/]/).pop()?.toLowerCase() === 'msedgewebview2.exe';
}

function formatSource(source: string): string {
  switch (source) {
    case 'registry':
      return 'Registry';
    case 'start-menu':
      return 'Start Menu';
    case 'running':
      return 'Running app';
    case 'packaged':
      return 'Packaged app';
    case 'custom':
      return 'Custom app';
    default:
      return source;
  }
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

  const confirmBroadWebViewAccess = () =>
    dialog.confirm({
      title: 'Allow WebView2 across apps?',
      message:
        'WebView2 is shared by multiple applications. Adding msedgewebview2.exe applies broadly and does not identify QuotaShift. For scoped access, approve the host app after Aevra verifies its window relationship.',
      confirmLabel: 'Allow broad WebView2 access',
      confirmTone: 'danger',
    });

  const handleToggleApp = async (row: AppRow, checked: boolean) => {
    if (!row.grantable || row.exeBasename === '—') return;
    if (checked && isWebViewRuntime(row.exeBasename) && !(await confirmBroadWebViewAccess()))
      return;
    onToggleApp(row.exeBasename, checked, row);
  };

  const appRows: AppRow[] = useMemo(() => {
    const knownBasenames = new Set(
      apps.flatMap((app) => (app.exeBasename ? [app.exeBasename.toLowerCase()] : [])),
    );
    const unlistedAllowed = applications.filter(
      (entry) => !knownBasenames.has(entry.toLowerCase()),
    );

    return [
      ...apps.map((app, index) => {
        const exeBasename = app.exeBasename ?? '—';
        const grantable =
          (app.grantable !== false || isWebViewRuntime(exeBasename)) && Boolean(app.exeBasename);
        const isAppAllowed =
          grantable && (Boolean(app.isGranted) || allowed.has(exeBasename.toLowerCase()));
        const sources = app.isCustom ? ['Custom'] : (app.sources ?? []).map(formatSource);
        return {
          rowId:
            app.executablePath?.replaceAll('/', '\\').toLowerCase() ??
            `unresolved:${sources.join(',')}:${app.displayName}:${index}`,
          exeBasename,
          displayName: app.displayName,
          version: app.version ?? '—',
          sources: sources.length > 0 ? sources.join(', ') : '—',
          executablePath: app.executablePath,
          status: (app.reason === 'shared-runtime' || isWebViewRuntime(exeBasename)
            ? 'Shared runtime'
            : grantable
              ? isAppAllowed
                ? 'Allowed'
                : 'Blocked'
              : 'Needs manual path') as AppRow['status'],
          allowed: isAppAllowed,
          grantable,
          isCustom: Boolean(app.isCustom),
          ...(app.grantId ? { grantId: app.grantId } : {}),
          ...(app.customAppId ? { customAppId: app.customAppId } : {}),
        };
      }),
      ...unlistedAllowed.map((exeBasename) => ({
        rowId: `policy:${exeBasename.toLowerCase()}`,
        exeBasename,
        displayName: exeBasename,
        version: '—',
        sources: 'Policy',
        status: 'Allowed' as const,
        allowed: true,
        grantable: true,
        isCustom: false,
      })),
    ];
  }, [apps, applications, allowed]);

  const handleOpenAdd = () => {
    setEditingApp(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (row: AppRow) => {
    if (!row.executablePath || row.exeBasename === '—') return;
    setEditingApp({
      displayName: row.displayName,
      version: row.version === '—' ? null : row.version,
      executablePath: row.executablePath || row.exeBasename,
      exeBasename: row.exeBasename,
      isCustom: true,
      customAppId: row.customAppId,
    });
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setEditingApp(null);
  };

  const handleSaveModal = async (app: DetectedApp, previousExeBasename?: string) => {
    onSaveCustomApp(app, previousExeBasename, editingApp?.customAppId);
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
    if (row.exeBasename === '—') return;
    onDeleteCustomApp(row.exeBasename, row.customAppId);
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
            disabled={busy || !row.grantable}
            onChange={(event) => void handleToggleApp(row, event.currentTarget.checked)}
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
        key: 'sources',
        label: 'Found in',
        sortable: true,
        search: true,
        render: (row) => <span>{row.sources}</span>,
      },
      {
        key: 'status',
        label: 'Status',
        sortable: true,
        render: (row) => (
          <span
            className={`desktop-app-status ${
              row.allowed ? 'is-allowed' : row.grantable ? 'is-blocked' : 'is-unavailable'
            }`}
            title={
              row.status === 'Shared runtime'
                ? 'This shared process cannot identify the application that hosts its window.'
                : undefined
            }
          >
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
          row.isCustom && row.grantable ? (
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

  const handleAddManual = async () => {
    const entry = manual.trim();
    if (!entry || isAllowed(entry)) return;
    if (isWebViewRuntime(entry) && !(await confirmBroadWebViewAccess())) return;
    setManual('');
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
          rowKey={(row) => row.rowId}
        />
      </div>
      <div className="desktop-manual-app-section">
        <div className="desktop-manual-app-header">
          <label htmlFor="desktopManualApp" className="desktop-manual-app-label">
            Add a legacy rule by program file name
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
          The catalog checks installed registrations, Start Menu shortcuts, visible windows, and
          packaged apps. Closed portable apps may still be missing; add their executable path above.
        </p>
      </div>
      {modalOpen ? (
        <AddCustomAppModal
          key={editingApp?.exeBasename ?? 'new'}
          open={modalOpen}
          initialApp={editingApp}
          existingPaths={apps.flatMap((app) => (app.executablePath ? [app.executablePath] : []))}
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
