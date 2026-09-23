import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteCustomApp,
  grantDesktopApp,
  loadDesktopAppGrants,
  loadDesktopPolicy,
  loadDetectedApps,
  loadStoredCustomApps,
  revokeDesktopAppGrant,
  saveCustomApp,
  saveDesktopPolicy,
  saveStoredCustomApps,
} from './desktop-control-api';
import { DesktopModeSelector, DesktopPathExposure } from './DesktopControlControls';
import type {
  AppCatalogRow,
  DesktopAppGrantRow,
  DesktopAppsLoadResult,
  DesktopPolicySnapshot,
  DetectedApp,
} from './desktop-control-types';
import { DesktopAppPicker } from './DesktopAppPicker';
import { migrateLocalCustomApps } from './custom-app-migration';

export * from './desktop-control-api';
export * from './desktop-control-types';
export { DesktopModeSelector, DesktopPathExposure } from './DesktopControlControls';
/**
 * Which apps `desktop.control` may act on, and whether the model is told
 * their full executable paths. Self-loading, like `BrowserOriginPolicy`:
 * there is no parent-owned status object this depends on.
 */
export function DesktopControlSettings({
  load = loadDesktopPolicy,
  save = saveDesktopPolicy,
  loadApps = loadDetectedApps,
}: {
  load?: () => Promise<DesktopPolicySnapshot>;
  save?: (next: Partial<DesktopPolicySnapshot>) => Promise<DesktopPolicySnapshot>;
  loadApps?: () => Promise<DesktopAppsLoadResult>;
}) {
  const [policy, setPolicy] = useState<DesktopPolicySnapshot | null>(null);
  const [apps, setApps] = useState<AppCatalogRow[]>([]);
  const [localCustomApps, setLocalCustomApps] = useState<DetectedApp[]>(loadStoredCustomApps);
  const [grants, setGrants] = useState<DesktopAppGrantRow[]>([]);
  const [appWarnings, setAppWarnings] = useState<string[]>([]);
  const [busyTarget, setBusyTarget] = useState<'mode' | 'apps' | 'path' | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const policyRef = useRef(policy);
  policyRef.current = policy;

  const busyTargetRef = useRef<'mode' | 'apps' | 'path' | null>(null);

  const refreshCatalog = useCallback(async () => {
    const result = await loadApps();
    const nextApps = Array.isArray(result) ? result : result.apps;
    const warnings = Array.isArray(result) ? [] : (result.warnings ?? []);
    setApps(nextApps);
    setAppWarnings(warnings);
    try {
      const resultGrants = await loadDesktopAppGrants();
      setGrants(resultGrants.grants);
    } catch {
      setGrants([]);
    }
  }, [loadApps]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    void load()
      .then((next) => {
        if (!cancelled) setPolicy(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    void refreshCatalog().catch(() => {
      if (!cancelled) setAppWarnings(['Some app sources could not be read.']);
    });
    return () => {
      cancelled = true;
    };
  }, [load, refreshCatalog]);

  const submit = useCallback(
    async (next: Partial<DesktopPolicySnapshot>, target: 'mode' | 'apps' | 'path') => {
      if (busyTargetRef.current !== null) return;
      busyTargetRef.current = target;
      setBusyTarget(target);
      setError('');
      setToast(null);
      try {
        const updated = await save(next);
        setPolicy(updated);
        setToast('// Desktop policy saved.');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        busyTargetRef.current = null;
        setBusyTarget(null);
      }
    },
    [save],
  );

  const onModeChange = useCallback(
    (mode: 'allowlist' | 'denylist') => {
      void submit({ mode }, 'mode');
    },
    [submit],
  );

  const onToggleApp = useCallback(
    async (
      exeBasename: string,
      checked: boolean,
      row?: {
        exeBasename: string;
        executablePath?: string;
        displayName?: string;
        grantId?: string;
        status?: string;
      },
    ) => {
      const current = policyRef.current;
      if (!current) return;
      if (busyTargetRef.current !== null) return;
      busyTargetRef.current = 'apps';
      setBusyTarget('apps');
      setError('');
      try {
        if (row?.exeBasename.toLowerCase() === 'msedgewebview2.exe') {
          // WebView2 is a shared runtime. Its catalog toggle is deliberately
          // the explicit broad legacy rule, never an exact-path runtime grant.
          if (row.grantId) await revokeDesktopAppGrant(row.grantId);
          const alreadyListed = current.applications.some(
            (entry) => entry.toLowerCase() === exeBasename.toLowerCase(),
          );
          const applications = checked
            ? alreadyListed
              ? current.applications
              : [...current.applications, exeBasename]
            : current.applications.filter(
                (entry) => entry.toLowerCase() !== exeBasename.toLowerCase(),
              );
          setPolicy(await save({ applications }));
          await refreshCatalog();
          setToast(checked ? '// Broad WebView2 access enabled.' : '// WebView2 access revoked.');
          return;
        }
        if (row?.executablePath) {
          if (checked) {
            await grantDesktopApp({
              executablePath: row.executablePath,
              displayName: row.displayName ?? exeBasename,
            });
          } else {
            if (row.grantId) await revokeDesktopAppGrant(row.grantId);
            const applications = current.applications.filter(
              (entry) => entry.toLowerCase() !== exeBasename.toLowerCase(),
            );
            if (applications.length !== current.applications.length)
              setPolicy(await save({ applications }));
          }
          await refreshCatalog();
          setToast(checked ? '// App access granted.' : '// App access revoked.');
        } else {
          const applications = checked
            ? [...current.applications, exeBasename]
            : current.applications.filter(
                (entry) => entry.toLowerCase() !== exeBasename.toLowerCase(),
              );
          setPolicy(await save({ applications }));
          setToast('// Desktop policy saved.');
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        busyTargetRef.current = null;
        setBusyTarget(null);
      }
    },
    [refreshCatalog, save],
  );

  const onAddManualApp = useCallback(
    (entry: string) => {
      const current = policyRef.current;
      if (!current) return;
      void submit({ applications: [...current.applications, entry] }, 'apps');
    },
    [submit],
  );

  const onSaveCustomApp = useCallback(
    async (app: DetectedApp, _previousExeBasename?: string, customAppId?: string) => {
      try {
        await saveCustomApp(app, customAppId);
        await refreshCatalog();
        setToast(customAppId ? '// Custom application updated.' : '// Custom application added.');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [refreshCatalog],
  );

  const onDeleteCustomApp = useCallback(
    async (_exeBasename: string, customAppId?: string) => {
      if (!customAppId) return;
      try {
        await deleteCustomApp(customAppId);
        await refreshCatalog();
        setToast('// Custom application removed.');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [refreshCatalog],
  );

  const onMigrateLocalApps = useCallback(async () => {
    if (localCustomApps.length === 0 || busyTargetRef.current !== null) return;
    busyTargetRef.current = 'apps';
    setBusyTarget('apps');
    setError('');
    try {
      const result = await migrateLocalCustomApps(localCustomApps, (app) =>
        saveCustomApp(app).then((saved) => saved.app),
      );
      saveStoredCustomApps(result.remaining);
      setLocalCustomApps(result.remaining);
      await refreshCatalog();
      setToast(`// Imported ${result.imported} custom app${result.imported === 1 ? '' : 's'}.`);
      if (result.failed > 0)
        setError(
          `${result.failed} app${result.failed === 1 ? '' : 's'} could not be imported. They remain saved in this browser so you can retry.`,
        );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      busyTargetRef.current = null;
      setBusyTarget(null);
    }
  }, [localCustomApps, refreshCatalog]);

  const onPathExposureChange = useCallback(
    (checked: boolean) => {
      void submit({ exposeExecutablePaths: checked }, 'path');
    },
    [submit],
  );

  const allApps = useMemo(() => apps, [apps]);

  if (!policy) {
    return (
      <section
        className="panel settings-compact-panel desktop-control-panel wide"
        role="region"
        aria-label="Desktop control"
      >
        <div className="compact-settings-copy">
          <h3>Desktop control</h3>
        </div>
        {error ? (
          <p role="alert" className="inline-result warning-text">
            {error}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section
      className="panel settings-compact-panel desktop-control-panel wide"
      role="region"
      aria-label="Desktop control"
    >
      <div className="compact-settings-copy">
        <h3>Desktop control</h3>
        <span>Restrict which apps computer use can see and act on.</span>
      </div>
      <DesktopModeSelector
        mode={policy.mode}
        disabled={busyTarget === 'mode'}
        onModeChange={onModeChange}
      />
      {localCustomApps.length > 0 ? (
        <div className="desktop-custom-app-migration" role="status">
          <span>
            {localCustomApps.length} custom app{localCustomApps.length === 1 ? '' : 's'} are saved
            in this browser.
          </span>
          <button
            type="button"
            disabled={busyTarget !== null}
            onClick={() => void onMigrateLocalApps()}
          >
            Import to Aevra
          </button>
        </div>
      ) : null}
      {policy.mode === 'allowlist' ? (
        <DesktopAppPicker
          applications={policy.applications}
          apps={allApps}
          busy={busyTarget === 'apps'}
          onToggleApp={onToggleApp}
          onAddManualApp={onAddManualApp}
          onSaveCustomApp={onSaveCustomApp}
          onDeleteCustomApp={onDeleteCustomApp}
        />
      ) : null}
      {grants.length > 0 ? (
        <div className="desktop-app-grants" aria-label="Granted apps">
          <h4>Exact app grants</h4>
          {grants.map((grant) => (
            <div className="desktop-app-grant-row" key={grant.id}>
              <span>
                <strong>{grant.displayName}</strong>
                <small>
                  {grant.sessionId ? 'This session' : 'Persistent'} · {grant.executablePath}
                </small>
              </span>
              <button
                type="button"
                className="danger-button"
                disabled={busyTarget !== null}
                onClick={() =>
                  void revokeDesktopAppGrant(grant.id)
                    .then(refreshCatalog)
                    .then(() => setToast('// App grant revoked.'))
                    .catch((cause: unknown) =>
                      setError(cause instanceof Error ? cause.message : String(cause)),
                    )
                }
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {appWarnings.length > 0 ? (
        <p className="section-note" role="status">
          App discovery is partial: {appWarnings.join('; ')}
        </p>
      ) : null}
      <DesktopPathExposure
        exposeExecutablePaths={policy.exposeExecutablePaths === true}
        disabled={busyTarget === 'path'}
        onChange={onPathExposureChange}
      />
      {toast ? (
        <div className="toast-stack">
          <div className="toast success" role="status">
            {toast}
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="inline-result warning-text">
          {error}
        </p>
      ) : null}
    </section>
  );
}
