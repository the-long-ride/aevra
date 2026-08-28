import type { AdminPageId, RuntimeHealthStatus } from '@aevra/admin-contracts';
import { ADMIN_SURFACE } from '@aevra/admin-contracts';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useMcpActivityEntries } from '../hooks/use-mcp-activity';
import type { Theme } from '../hooks/theme-state';

export function isVersionOutdated(current?: string, latest?: string): boolean {
  if (!current || !latest) return false;
  const clean = (v: string) =>
    v
      .replace(/^v/, '')
      .trim()
      .split('.')
      .map((x) => parseInt(x, 10) || 0);
  const [cMaj = 0, cMin = 0, cPatch = 0] = clean(current);
  const [lMaj = 0, lMin = 0, lPatch = 0] = clean(latest);
  if (lMaj > cMaj) return true;
  if (lMaj === cMaj && lMin > cMin) return true;
  if (lMaj === cMaj && lMin === cMin && lPatch > cPatch) return true;
  return false;
}

interface AppShellProps {
  page: AdminPageId;
  status: RuntimeHealthStatus;
  theme: Theme;
  pendingCount: number;
  requestsOpen: boolean;
  onNavigate(page: AdminPageId): void;
  onToggleTheme(): void;
  onOpenRequests(): void;
  children: ReactNode;
}

function healthState(key: 'core' | 'worker' | 'mcp' | 'tunnel', status: RuntimeHealthStatus) {
  if (key === 'tunnel') {
    if (status.tunnel === 'unconfigured') return 'off';
    if (status.tunnelReachable === true) return 'ok';
    if (status.tunnelReachable === false) return 'error';
    return status.tunnel === 'configured' ? 'pending' : 'off';
  }
  const value = String(status[key] ?? '').toLowerCase();
  if (['running', 'ready', 'connected'].includes(value)) return 'ok';
  if (['starting', 'checking', 'reconnecting'].includes(value)) {
    return 'pending';
  }
  return 'error';
}

function HealthChip({
  name,
  status,
}: {
  name: 'core' | 'worker' | 'mcp' | 'tunnel';
  status: RuntimeHealthStatus;
}) {
  return (
    <span className="health-chip" data-health={name} data-state={healthState(name, status)}>
      <i />
      <span>{name === 'mcp' ? 'MCP' : name[0].toUpperCase() + name.slice(1)}</span>
    </span>
  );
}

function ToolRunningSignal({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span
      className="tool-running-signal"
      role="status"
      aria-label={`${count} tool ${count === 1 ? 'call' : 'calls'} running`}
      title={`${count} tool ${count === 1 ? 'call' : 'calls'} running`}
    >
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export function AppShell({
  page,
  status,
  theme,
  pendingCount,
  requestsOpen,
  onNavigate,
  onToggleTheme,
  onOpenRequests,
  children,
}: AppShellProps) {
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const activity = useMcpActivityEntries();
  const runningToolCount = activity.filter(
    (entry) => entry.kind === 'tool' && entry.state === 'running',
  ).length;

  useEffect(() => {
    if (!status.version) return;
    const controller = new AbortController();
    fetch('https://registry.npmjs.org/@the-long-ride/aevra/latest', {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data.version === 'string') {
          setLatestVersion(data.version);
        }
      })
      .catch(() => {
        // Silently ignore network errors / offline state
      });

    return () => {
      controller.abort();
    };
  }, [status.version]);

  const isOutdated = isVersionOutdated(status.version, latestVersion ?? undefined);
  const updateCommand = 'npm i -g @the-long-ride/aevra@latest';

  const handleCopyUpdate = async () => {
    try {
      await navigator.clipboard.writeText(updateCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const version = status.version
    ? String(status.version).startsWith('v')
      ? String(status.version)
      : `v${status.version}`
    : '';
  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  return (
    <div className="app-shell" data-testid="react-admin-root">
      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src="/aevra-logo.png" alt="" aria-hidden="true" />
          <div>
            <strong>
              Aevra <span className="app-version">{version}</span>
              {isOutdated ? (
                <button
                  type="button"
                  className="version-update-btn"
                  title="Click to copy update command"
                  aria-label="Click to copy update command"
                  onClick={handleCopyUpdate}
                >
                  <code>{updateCommand}</code>
                  {copied ? <span className="copied-tag">[copied]</span> : null}
                </button>
              ) : null}
            </strong>
            <small>Local MCP control plane</small>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="health-cluster">
            <ToolRunningSignal count={runningToolCount} />
            {(['core', 'worker', 'mcp', 'tunnel'] as const).map((name) => (
              <HealthChip key={name} name={name} status={status} />
            ))}
          </div>
          <button
            type="button"
            className="theme-toggle"
            aria-label={`Switch to ${nextTheme} mode`}
            onClick={onToggleTheme}
          >
            [{theme}]
          </button>
          <button
            type="button"
            id="open-requests"
            className={pendingCount > 0 ? 'has-pending' : ''}
            aria-expanded={requestsOpen}
            onClick={onOpenRequests}
          >
            Requests <b id="requests-count">{pendingCount}</b>
          </button>
        </div>
      </header>
      {status.safeMode ? (
        <div id="safe-mode-banner" className="safe-mode-banner">
          SAFE MODE: remote execution and administrative mutations are disabled.
        </div>
      ) : null}
      <nav className="top-nav" aria-label="Aevra admin">
        {ADMIN_SURFACE.navigation.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === page ? 'active' : ''}
            onClick={() => onNavigate(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <main id="page" className="page" data-page={page} data-surface-id={`page:${page}`}>
        {children}
      </main>
    </div>
  );
}
