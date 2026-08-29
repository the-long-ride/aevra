import { useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { useDialog } from '../../components/Dialog';
import { PageState } from '../../components/PageState';
import { Switch } from '../../components/Switch';
import { usePollingResource } from '../../hooks/use-polling-resource';
import { ConnectorModal } from './ConnectorModal';
import { ConnectionDetailModal, type ActiveConnection } from './ConnectionDetailModal';
import { dashboardOrder } from './dashboard-order';
import { loadDashboard, revokeActiveConnection, type DashboardData } from './dashboard-service';
import { Onboarding } from './DashboardOnboarding';
import { DashboardSection } from './DashboardSection';
import { McpActivityPanel } from './McpActivityPanel';
import { RemoteAccessPanel } from './RemoteAccessPanel';
import { RuntimeManagementModal } from './RuntimeManagementModal';
import { RuntimeOverview, type RuntimeModalKind } from './RuntimeOverview';
import { SystemCapabilities } from './SystemCapabilities';
import { TransportValidationModal } from './TransportValidationModal';

export function DashboardPage() {
  const resource = usePollingResource({ load: loadDashboard, intervalMs: 2000 });
  const dialog = useDialog();
  const [connectorModalOpen, setConnectorModalOpen] = useState(false);
  const [runtimeModal, setRuntimeModal] = useState<RuntimeModalKind | null>(null);
  const [transportModalOpen, setTransportModalOpen] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState<ActiveConnection | null>(null);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<Set<string>>(() => new Set());
  const [revokingConnections, setRevokingConnections] = useState(false);
  const data = resource.data;
  const selectedLive = selectedConnection?.id
    ? ((data?.snapshot.activeConnections.find((row: any) => row.id === selectedConnection.id) as
        ActiveConnection | undefined) ?? null)
    : null;

  if (!data) {
    return (
      <PageState loading={resource.loading} error={resource.error}>
        Dashboard
      </PageState>
    );
  }

  const selectableConnectionIds = data.snapshot.activeConnections
    .map((row: any) => String(row.id ?? row.sessionId ?? ''))
    .filter(Boolean);

  const selectedRows = data.snapshot.activeConnections.filter((row: any) =>
    selectedConnectionIds.has(String(row.id ?? row.sessionId ?? '')),
  );

  const toggleConnection = (id: string, checked: boolean) => {
    setSelectedConnectionIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedConnectionIds(new Set(selectableConnectionIds));
  };

  const unselectAll = () => {
    setSelectedConnectionIds(new Set());
  };

  const revokeSelected = async () => {
    if (!selectedRows.length || revokingConnections) return;
    const confirmed = await dialog.confirm({
      title: 'Revoke selected connections',
      message: `Revoke ${selectedRows.length} selected connection${selectedRows.length === 1 ? '' : 's'}?`,
      confirmLabel: 'Revoke selected',
      confirmTone: 'danger',
    });
    if (!confirmed) return;
    setRevokingConnections(true);
    try {
      const results = await Promise.allSettled(
        selectedRows.map((row: any) => revokeActiveConnection(row)),
      );
      const succeeded = new Set(
        selectedRows
          .filter((_, index) => results[index]?.status === 'fulfilled')
          .map((row: any) => String(row.id ?? row.sessionId ?? '')),
      );
      const failed = selectedRows.length - succeeded.size;
      setSelectedConnectionIds(
        (current) => new Set([...current].filter((id) => !succeeded.has(id))),
      );
      if (selectedConnection?.id && succeeded.has(selectedConnection.id))
        setSelectedConnection(null);
      await resource.refresh();
      if (failed) {
        void dialog.message({
          title: 'Connection revocation',
          actionLabel: 'Close',
          message: `${succeeded.size} connection${succeeded.size === 1 ? '' : 's'} revoked; ${failed} failed.`,
        });
      }
    } finally {
      setRevokingConnections(false);
    }
  };

  const sections = {
    onboarding: (
      <DashboardSection
        key="onboarding"
        id="onboarding"
        title="Onboarding"
        defaultOpen={!data.onboarding.completed}
      >
        <Onboarding data={data} refresh={resource.refresh} />
      </DashboardSection>
    ),
    'runtime-overview': (
      <DashboardSection key="runtime" id="runtime-overview" title="Runtime overview">
        <RuntimeOverview
          data={data}
          onOpen={setRuntimeModal}
          onOpenPending={() => document.getElementById('open-requests')?.click()}
          onOpenTransport={() => setTransportModalOpen(true)}
        />
      </DashboardSection>
    ),
    'live-mcp-activity': (
      <DashboardSection key="activity" id="live-mcp-activity" title="Live MCP activity">
        <McpActivityPanel workspaces={data.workspaces} />
      </DashboardSection>
    ),
    'active-connections': (
      <DashboardSection key="active" id="active-connections" title="Active connections">
        {data.snapshot.activeConnections.some((connection: any) => connection.yolo === true) ? (
          <p className="warning">
            YOLO enabled — immutable security approvals still require confirmation
          </p>
        ) : null}
        <div className="active-connections-toolbar">
          <div className="active-connections-toolbar-actions">
            <span>
              {selectedRows.length
                ? `${selectedRows.length} selected`
                : 'Select one or more connections to revoke'}
            </span>
            <div className="active-connections-selection-controls">
              <button
                type="button"
                className="compact-button"
                disabled={
                  !selectableConnectionIds.length ||
                  selectedRows.length === selectableConnectionIds.length
                }
                onClick={selectAll}
              >
                Select all
              </button>
              <button
                type="button"
                className="compact-button"
                disabled={!selectedRows.length}
                onClick={unselectAll}
              >
                Unselect all
              </button>
            </div>
          </div>
          <button
            type="button"
            className="danger-button"
            disabled={!selectedRows.length || revokingConnections}
            onClick={() => void revokeSelected()}
          >
            {revokingConnections ? 'Revoking…' : 'Revoke selected'}
          </button>
        </div>
        <DataTable
          id="react-dashboard-active"
          rows={data.snapshot.activeConnections}
          pageSize={10}
          filters={[
            { key: 'authType', label: 'Auth' },
            { key: 'status', label: 'Status' },
          ]}
          columns={[
            {
              key: 'select',
              label: 'Select',
              sortable: false,
              search: false,
              render: (row: any) => {
                const id = String(row.id ?? row.sessionId ?? '');
                const label = `Select ${String(row.client ?? id)}`;
                return id ? (
                  <Switch
                    label={<span className="sr-only">{label}</span>}
                    containerClassName="connection-select"
                    aria-label={label}
                    checked={selectedConnectionIds.has(id)}
                    onChange={(event) => toggleConnection(id, event.currentTarget.checked)}
                  />
                ) : null;
              },
            },
            { key: 'client', label: 'Client' },
            { key: 'authType', label: 'Auth' },
            {
              key: 'yolo',
              label: 'Mode',
              value: (row: any) => (row.yolo ? 'YOLO' : ''),
              render: (row: any) =>
                row.yolo ? (
                  <span
                    className="badge good"
                    title="YOLO enabled — immutable security approvals still require confirmation"
                  >
                    YOLO
                  </span>
                ) : null,
            },
            { key: 'workspace', label: 'Workspace' },
            {
              key: 'capabilities',
              label: 'Capabilities',
              value: (row: any) =>
                Array.isArray(row.capabilities)
                  ? row.capabilities.join(', ')
                  : String(row.capabilities ?? ''),
              render: (row: any) => {
                const caps: string[] = Array.isArray(row.capabilities) ? row.capabilities : [];
                if (!caps.length) return null;
                const fullText = caps.join(', ');
                const showCaps = () =>
                  void dialog.message({
                    title: 'Capabilities',
                    message: (
                      <div
                        className="dialog-capabilities-list"
                        style={{ display: 'grid', gap: '6px' }}
                      >
                        {caps.map((cap) => (
                          <code
                            key={cap}
                            className="capability-pill"
                            style={{ display: 'block', padding: '4px 8px', wordBreak: 'break-all' }}
                          >
                            {cap}
                          </code>
                        ))}
                      </div>
                    ),
                    actionLabel: 'Close',
                  });
                return (
                  <button
                    type="button"
                    className="capabilities-cell-button"
                    title={fullText}
                    onClick={showCaps}
                  >
                    <span className="capabilities-text">{fullText}</span>
                  </button>
                );
              },
            },
            { key: 'lastActivityAt', label: 'Last activity', dateTime: true },
            {
              key: 'actions',
              label: '',
              sortable: false,
              search: false,
              render: (row: any) => (
                <button
                  type="button"
                  data-surface-id="connections:details"
                  onClick={() => setSelectedConnection(row)}
                >
                  Details
                </button>
              ),
            },
          ]}
          emptyText="No active remote connections."
        />
      </DashboardSection>
    ),
    'system-capabilities': (
      <DashboardSection
        key="system-capabilities"
        id="system-capabilities"
        title="System capabilities"
      >
        <SystemCapabilities system={data.snapshot.system} />
      </DashboardSection>
    ),
  } satisfies Record<string, React.ReactNode>;

  return (
    <>
      <section className="page-head">
        <div>
          <h2>Dashboard</h2>
          <p>Local gateway runtime, connections, requests, and onboarding.</p>
        </div>
      </section>
      {dashboardOrder(data.onboarding.completed).map((id) => sections[id])}
      <RuntimeManagementModal
        kind={runtimeModal}
        data={data}
        onClose={() => setRuntimeModal(null)}
        onRefresh={resource.refresh}
        onCreateConnector={() => {
          setRuntimeModal(null);
          setConnectorModalOpen(true);
        }}
      />
      <TransportValidationModal
        open={transportModalOpen}
        transport={data.snapshot.transport}
        onClose={() => setTransportModalOpen(false)}
      />
      <ConnectorModal
        open={connectorModalOpen}
        onClose={() => setConnectorModalOpen(false)}
        onCreated={resource.refresh}
      />
      <ConnectionDetailModal
        connection={selectedLive}
        workspaces={data.workspaces}
        onClose={() => setSelectedConnection(null)}
        onChanged={resource.refresh}
      />
    </>
  );
}
