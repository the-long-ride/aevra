import { ADMIN_SURFACE, type AdminPageId } from '@aevra/admin-contracts';
import { useState, type ComponentType } from 'react';
import { AppShell } from '../components/AppShell';
import { AuditPage } from '../features/audit/AuditPage';
import { ChangesPage } from '../features/changes/ChangesPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { GuidePage } from '../features/guide/GuidePage';
import { PermissionsPage } from '../features/permissions/PermissionsPage';
import { ProcessesPage } from '../features/processes/ProcessesPage';
import { RequestDrawer } from '../features/requests/RequestDrawer';
import { SessionsPage } from '../features/sessions/SessionsPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { WorkspacesPage } from '../features/workspaces/WorkspacesPage';
import { useRuntimeStatus } from '../hooks/use-runtime-status';
import { useTheme } from '../hooks/use-theme';
import { useHashPage } from './use-hash-page';

const pageRegistry: Record<AdminPageId, ComponentType> = {
  dashboard: DashboardPage,
  workspaces: WorkspacesPage,
  permissions: PermissionsPage,
  sessions: SessionsPage,
  processes: ProcessesPage,
  changes: ChangesPage,
  audit: AuditPage,
  settings: SettingsPage,
  guide: GuidePage,
};

export function App() {
  const { page, navigate } = useHashPage();
  const status = useRuntimeStatus();
  const { theme, toggleTheme } = useTheme();
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const Page = pageRegistry[page];

  if (!ADMIN_SURFACE.navigation.some((item) => item.id === page)) {
    return null;
  }

  return (
    <>
      <AppShell
        page={page}
        status={status}
        theme={theme}
        pendingCount={pendingCount}
        requestsOpen={requestsOpen}
        onNavigate={navigate}
        onToggleTheme={toggleTheme}
        onOpenRequests={() => setRequestsOpen(true)}
      >
        <Page />
      </AppShell>
      <RequestDrawer
        open={requestsOpen}
        onClose={() => setRequestsOpen(false)}
        onPendingCountChange={setPendingCount}
      />
    </>
  );
}
