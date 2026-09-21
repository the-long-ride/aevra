import { ADMIN_SURFACE, type AdminPageId } from '@aevra/admin-contracts';
import { useCallback, useRef, useState, type ComponentType } from 'react';
import { AppShell } from '../components/AppShell';
import { DialogProvider } from '../components/Dialog';
import { AdminAuthGate } from '../features/auth/AdminAuthGate';
import { AuditPage } from '../features/audit/AuditPage';
import { AboutPage } from '../features/about/AboutPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { DataPage } from '../features/data/DataPage';
import { GuidePage } from '../features/guide/GuidePage';
import { PermissionsPage } from '../features/permissions/PermissionsPage';
import { RequestApprovalModal } from '../features/requests/RequestApprovalModal';
import { RequestDrawer } from '../features/requests/RequestDrawer';
import type { RequestsData } from '../features/requests/requests-service';
import { SessionsPage } from '../features/sessions/SessionsPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { WorkspacesPage } from '../features/workspaces/WorkspacesPage';
import type { Theme } from '../hooks/theme-state';
import { McpActivityProvider } from '../hooks/use-mcp-activity';
import { useRuntimeStatus } from '../hooks/use-runtime-status';
import { useTheme } from '../hooks/use-theme';
import { useHashPage } from './use-hash-page';

const pageRegistry: Record<AdminPageId, ComponentType> = {
  dashboard: DashboardPage,
  workspaces: WorkspacesPage,
  permissions: PermissionsPage,
  sessions: SessionsPage,
  audit: AuditPage,
  settings: SettingsPage,
  data: DataPage,
  guide: GuidePage,
  about: AboutPage,
};

function AuthenticatedApp({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const { page, navigate } = useHashPage();
  const status = useRuntimeStatus();
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [approvalModalData, setApprovalModalData] = useState<RequestsData | null>(null);
  const drawerRefreshRef = useRef<(() => Promise<void>) | null>(null);
  const Page = pageRegistry[page];

  const handleNewPending = useCallback((data: RequestsData) => {
    setApprovalModalData(data);
  }, []);

  const handlePendingSync = useCallback((data: RequestsData) => {
    setApprovalModalData((current) => {
      if (!current) return null;
      const pendingItems = data.approvals.filter((item) => item.state === 'PENDING');
      const count = pendingItems.length + data.oauth.length;
      if (count === 0) return null;
      return data;
    });
  }, []);

  const handleModalActioned = useCallback(async () => {
    // Close first, refresh second. The decision has already been recorded by the
    // time this runs, so the modal is showing a question that is no longer open.
    // Awaiting the refresh before closing meant any failure inside loadRequests -
    // it fans out to three endpoints - skipped the close entirely and stranded the
    // dialog on screen until the page was reloaded.
    setApprovalModalData(null);
    try {
      await drawerRefreshRef.current?.();
    } catch {
      // The drawer polls every 2.2s and will pick the new state up on its own.
    }
  }, []);

  const handleModalDismiss = useCallback(() => {
    setApprovalModalData(null);
  }, []);

  if (!ADMIN_SURFACE.navigation.some((item) => item.id === page)) {
    return null;
  }

  return (
    <DialogProvider>
      <AppShell
        page={page}
        status={status}
        theme={theme}
        pendingCount={pendingCount}
        requestsOpen={requestsOpen}
        onNavigate={navigate}
        onToggleTheme={onToggleTheme}
        onOpenRequests={() => setRequestsOpen(true)}
      >
        <Page />
      </AppShell>
      <RequestDrawer
        open={requestsOpen}
        onClose={() => setRequestsOpen(false)}
        onPendingCountChange={setPendingCount}
        onNewPending={handleNewPending}
        onPendingSync={handlePendingSync}
        refreshRef={drawerRefreshRef}
      />
      {approvalModalData ? (
        <RequestApprovalModal
          data={approvalModalData}
          onActioned={handleModalActioned}
          onDismiss={handleModalDismiss}
        />
      ) : null}
    </DialogProvider>
  );
}

export function App() {
  const { theme, toggleTheme } = useTheme();

  return (
    <AdminAuthGate theme={theme} onToggleTheme={toggleTheme}>
      <McpActivityProvider>
        <AuthenticatedApp theme={theme} onToggleTheme={toggleTheme} />
      </McpActivityProvider>
    </AdminAuthGate>
  );
}
