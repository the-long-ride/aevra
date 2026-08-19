import type { AdminPageId, RuntimeHealthStatus } from '@aevra/admin-contracts';
import { ADMIN_SURFACE } from '@aevra/admin-contracts';
import type { ReactNode } from 'react';
import type { Theme } from '../hooks/theme-state';

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
          <span className="brand-mark">A</span>
          <div>
            <strong>
              Aevra <span className="app-version">{version}</span>
            </strong>
            <small>Local MCP control plane</small>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="health-cluster">
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
      <main id="page" className="page" data-surface-id={`page:${page}`}>
        {children}
      </main>
    </div>
  );
}
