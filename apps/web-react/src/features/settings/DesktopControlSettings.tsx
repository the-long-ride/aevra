import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Switch } from '../../components/Switch';
import { requestJson } from '../../services/api-client';
import { DesktopAppPicker } from './DesktopAppPicker';

export interface DetectedApp {
  displayName: string;
  version: string | null;
  executablePath: string;
  exeBasename: string;
  isCustom?: boolean;
}

export interface DesktopPolicySnapshot {
  mode: 'allowlist' | 'denylist';
  applications: string[];
  exposeExecutablePaths?: boolean;
  unattributedInput: 'allow' | 'deny';
  deniedTitlePatterns?: string[];
}

export const CUSTOM_APPS_STORAGE_KEY = 'aevra.custom_desktop_apps';

export function loadStoredCustomApps(): DetectedApp[] {
  try {
    const raw = window.localStorage.getItem(CUSTOM_APPS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DetectedApp[]) : [];
  } catch {
    return [];
  }
}

export function saveStoredCustomApps(apps: DetectedApp[]): void {
  try {
    window.localStorage.setItem(CUSTOM_APPS_STORAGE_KEY, JSON.stringify(apps));
  } catch {
    // ignore
  }
}

export const loadDesktopPolicy = () => requestJson<DesktopPolicySnapshot>('/api/desktop/policy');

export const saveDesktopPolicy = (next: Partial<DesktopPolicySnapshot>) =>
  requestJson<DesktopPolicySnapshot>('/api/desktop/policy', {
    method: 'POST',
    body: JSON.stringify(next),
  });

export const loadDetectedApps = () =>
  requestJson<{ apps: DetectedApp[] }>('/api/desktop/apps').then((response) => response.apps);

interface DesktopModeSelectorProps {
  mode: 'allowlist' | 'denylist';
  disabled: boolean;
  onModeChange: (mode: 'allowlist' | 'denylist') => void;
}

export const DesktopModeSelector = memo(function DesktopModeSelector({
  mode,
  disabled,
  onModeChange,
}: DesktopModeSelectorProps) {
  return (
    <fieldset className="console-fieldset">
      <legend>Apps computer use can touch</legend>
      <div
        className="console-radio-group"
        role="radiogroup"
        aria-label="Apps computer use can touch"
      >
        <label
          className={`console-radio-option${mode === 'denylist' ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}
        >
          <input
            type="radio"
            name="desktopMode"
            value="denylist"
            checked={mode === 'denylist'}
            disabled={disabled}
            onChange={() => onModeChange('denylist')}
          />
          <span>Allow all apps</span>
        </label>
        <label
          className={`console-radio-option${mode === 'allowlist' ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}
        >
          <input
            type="radio"
            name="desktopMode"
            value="allowlist"
            checked={mode === 'allowlist'}
            disabled={disabled}
            onChange={() => onModeChange('allowlist')}
          />
          <span>Only these apps</span>
        </label>
      </div>
      <p className="section-note console-radio-hint">
        {mode === 'denylist'
          ? 'Only a few sensitive apps stay blocked.'
          : 'Computer use is refused for anything not checked below.'}{' '}
        Switching mode clears the list, because an allow list and a block list cannot mean the same
        thing.
      </p>
    </fieldset>
  );
});

interface DesktopPathExposureProps {
  exposeExecutablePaths: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}

export const DesktopPathExposure = memo(function DesktopPathExposure({
  exposeExecutablePaths,
  disabled,
  onChange,
}: DesktopPathExposureProps) {
  return (
    <div className="desktop-path-exposure-row">
      <Switch
        checked={exposeExecutablePaths}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        containerClassName="desktop-path-exposure-label"
        label={
          <div className="desktop-path-exposure-info">
            <span className="desktop-path-exposure-title">Show file paths to the AI</span>
            <span className="section-note">
              Include full executable filesystem paths in computer-use tool responses.
            </span>
          </div>
        }
      />
    </div>
  );
});

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
  loadApps?: () => Promise<DetectedApp[]>;
}) {
  const [policy, setPolicy] = useState<DesktopPolicySnapshot | null>(null);
  const [apps, setApps] = useState<DetectedApp[]>([]);
  const [customApps, setCustomApps] = useState<DetectedApp[]>(loadStoredCustomApps);
  const [busyTarget, setBusyTarget] = useState<'mode' | 'apps' | 'path' | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const policyRef = useRef(policy);
  policyRef.current = policy;

  const busyTargetRef = useRef<'mode' | 'apps' | 'path' | null>(null);

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
    void loadApps()
      .then((next) => {
        if (!cancelled) setApps(next);
      })
      .catch(() => {
        /* An empty picker is a safe degradation; the policy load above already surfaces errors. */
      });
    return () => {
      cancelled = true;
    };
  }, [load, loadApps]);

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
    (exeBasename: string, checked: boolean) => {
      const current = policyRef.current;
      if (!current) return;
      const applications = checked
        ? [...current.applications, exeBasename]
        : current.applications.filter((entry) => entry.toLowerCase() !== exeBasename.toLowerCase());
      void submit({ applications }, 'apps');
    },
    [submit],
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
    (app: DetectedApp, previousExeBasename?: string) => {
      const prevLower = previousExeBasename?.toLowerCase();
      const nextLower = app.exeBasename.toLowerCase();

      setCustomApps((prev) => {
        const filtered = prev.filter((entry) => {
          const l = entry.exeBasename.toLowerCase();
          return l !== nextLower && (!prevLower || l !== prevLower);
        });
        const next = [...filtered, app];
        saveStoredCustomApps(next);
        return next;
      });

      const current = policyRef.current;
      if (!current) return;

      let nextApps = current.applications;
      if (prevLower && prevLower !== nextLower) {
        nextApps = nextApps.map((exe) => (exe.toLowerCase() === prevLower ? app.exeBasename : exe));
      }
      if (!nextApps.some((exe) => exe.toLowerCase() === nextLower)) {
        nextApps = [...nextApps, app.exeBasename];
      }
      if (nextApps !== current.applications) {
        void submit({ applications: nextApps }, 'apps');
      }
      setToast(
        previousExeBasename ? '// Custom application updated.' : '// Custom application added.',
      );
    },
    [submit],
  );

  const onDeleteCustomApp = useCallback(
    (exeBasename: string) => {
      const lower = exeBasename.toLowerCase();
      setCustomApps((prev) => {
        const next = prev.filter((entry) => entry.exeBasename.toLowerCase() !== lower);
        saveStoredCustomApps(next);
        return next;
      });

      const current = policyRef.current;
      if (!current) return;
      const filtered = current.applications.filter((exe) => exe.toLowerCase() !== lower);
      if (filtered.length !== current.applications.length) {
        void submit({ applications: filtered }, 'apps');
      }
      setToast('// Custom application removed.');
    },
    [submit],
  );

  const onPathExposureChange = useCallback(
    (checked: boolean) => {
      void submit({ exposeExecutablePaths: checked }, 'path');
    },
    [submit],
  );

  const allApps = useMemo(() => {
    const customMap = new Map(customApps.map((c) => [c.exeBasename.toLowerCase(), c]));
    const systemApps = apps
      .filter((a) => !customMap.has(a.exeBasename.toLowerCase()))
      .map((a) => ({ ...a, isCustom: false }));
    const markedCustom = customApps.map((c) => ({ ...c, isCustom: true }));
    return [...systemApps, ...markedCustom];
  }, [apps, customApps]);

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
