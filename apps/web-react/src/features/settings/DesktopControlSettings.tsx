import { useEffect, useState } from 'react';
import { requestJson } from '../../services/api-client';

export interface DetectedApp {
  displayName: string;
  version: string | null;
  executablePath: string;
  exeBasename: string;
}

export interface DesktopPolicySnapshot {
  mode: 'allowlist' | 'denylist';
  applications: string[];
  exposeExecutablePaths?: boolean;
  unattributedInput: 'allow' | 'deny';
  deniedTitlePatterns?: string[];
}

export const loadDesktopPolicy = () => requestJson<DesktopPolicySnapshot>('/api/desktop/policy');

export const saveDesktopPolicy = (next: Partial<DesktopPolicySnapshot>) =>
  requestJson<DesktopPolicySnapshot>('/api/desktop/policy', {
    method: 'POST',
    body: JSON.stringify(next),
  });

export const loadDetectedApps = () =>
  requestJson<{ apps: DetectedApp[] }>('/api/desktop/apps').then((response) => response.apps);

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
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

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

  const submit = async (next: Partial<DesktopPolicySnapshot>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      setPolicy(await save(next));
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

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

  // Every comparison against `applications` is case-insensitive, matching the
  // window gate and `desktop_apps`, which both lowercase before matching. An
  // exact-case check here would render an entry like `1Password.exe` as an
  // unchecked box next to a detected `1password.exe` AND as a second "not
  // detected" row - one app shown twice, in contradictory states, while the
  // gate treats them as the same single rule.
  const allowed = new Set(policy.applications.map((entry) => entry.toLowerCase()));
  const isAllowed = (exeBasename: string) => allowed.has(exeBasename.toLowerCase());

  const toggleApp = (exeBasename: string, checked: boolean) => {
    const applications = checked
      ? [...policy.applications, exeBasename]
      : policy.applications.filter((entry) => entry.toLowerCase() !== exeBasename.toLowerCase());
    void submit({ applications });
  };

  const addManualApp = () => {
    const entry = manual.trim();
    setManual('');
    if (!entry || isAllowed(entry)) return;
    void submit({ applications: [...policy.applications, entry] });
  };

  const knownBasenames = new Set(apps.map((app) => app.exeBasename.toLowerCase()));
  const unlistedAllowed = policy.applications.filter(
    (entry) => !knownBasenames.has(entry.toLowerCase()),
  );

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
      <fieldset>
        <legend>Apps computer use can touch</legend>
        <label>
          <input
            type="radio"
            name="desktopMode"
            value="denylist"
            checked={policy.mode === 'denylist'}
            disabled={busy}
            onChange={() => void submit({ mode: 'denylist' })}
          />
          Allow all apps{' '}
          <span className="section-note">Only a few sensitive apps stay blocked.</span>
        </label>
        <label>
          <input
            type="radio"
            name="desktopMode"
            value="allowlist"
            checked={policy.mode === 'allowlist'}
            disabled={busy}
            onChange={() => void submit({ mode: 'allowlist' })}
          />
          Only these apps{' '}
          <span className="section-note">
            Computer use is refused for anything not checked below. Switching mode clears the list,
            because an allow list and a block list cannot mean the same thing.
          </span>
        </label>
      </fieldset>
      {policy.mode === 'allowlist' ? (
        <>
          <div className="choice-grid compact desktop-app-picker">
            {apps.map((app) => (
              <label key={app.exeBasename} className="choice-inline">
                <input
                  type="checkbox"
                  checked={isAllowed(app.exeBasename)}
                  disabled={busy}
                  onChange={(event) => toggleApp(app.exeBasename, event.currentTarget.checked)}
                />
                {app.displayName}
                {app.version ? <small> v{app.version}</small> : null}
              </label>
            ))}
            {unlistedAllowed.map((exeBasename) => (
              <label key={exeBasename} className="choice-inline">
                <input
                  type="checkbox"
                  checked
                  disabled={busy}
                  onChange={(event) => toggleApp(exeBasename, event.currentTarget.checked)}
                />
                {exeBasename}
              </label>
            ))}
          </div>
          <label htmlFor="desktopManualApp">Add an app by program file name</label>
          <input
            id="desktopManualApp"
            value={manual}
            disabled={busy}
            placeholder="Docker Desktop.exe"
            onChange={(event) => setManual(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addManualApp();
              }
            }}
          />
          <p className="section-note">
            Detection only finds apps that register a program file, so some are missing above. Use
            the name the app runs as, not its installer.
          </p>
          <div className="actions compact-settings-actions">
            <button type="button" disabled={busy} onClick={addManualApp}>
              Add app
            </button>
          </div>
        </>
      ) : null}
      <label>
        <input
          type="checkbox"
          checked={policy.exposeExecutablePaths === true}
          disabled={busy}
          onChange={(event) => void submit({ exposeExecutablePaths: event.currentTarget.checked })}
        />
        Show file paths to the AI
      </label>
      {saved ? <p className="inline-result">Desktop policy saved.</p> : null}
      {error ? (
        <p role="alert" className="inline-result warning-text">
          {error}
        </p>
      ) : null}
    </section>
  );
}
