import { useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { useDialog } from '../../components/Dialog';
import { PageState } from '../../components/PageState';
import { Switch } from '../../components/Switch';
import { usePollingResource } from '../../hooks/use-polling-resource';
import { ConnectorModal } from './ConnectorModal';
import { ConnectionDetailModal, type ActiveConnection } from './ConnectionDetailModal';
import { dashboardOrder } from './dashboard-order';
import {
  completeOnboarding,
  loadDashboard,
  registerWorkspace,
  revokeActiveConnection,
  type DashboardData,
} from './dashboard-service';
import { DashboardSection } from './DashboardSection';
import { McpActivityPanel } from './McpActivityPanel';
import { RemoteAccessPanel } from './RemoteAccessPanel';
import { RuntimeManagementModal } from './RuntimeManagementModal';
import { RuntimeOverview, type RuntimeModalKind } from './RuntimeOverview';
import { SystemCapabilities } from './SystemCapabilities';
import { TransportValidationModal } from './TransportValidationModal';

function Onboarding({ data, refresh }: { data: DashboardData; refresh(): Promise<void> }) {
  const endpoint = data.exposure.publicUrl
    ? `${data.exposure.publicUrl}/mcp`
    : 'Configure Remote Access first';
  const providers = [
    ['ChatGPT', 'Create a custom MCP app and use OAuth.'],
    ['Claude', 'Add a remote MCP server and authenticate with OAuth.'],
    ['Gemini', 'Add the MCP endpoint and complete OAuth.'],
  ];
  return (
    <div className="onboarding-body">
      <section className="onboarding-block wide" data-onboarding-section="remote-access">
        <div className="section-heading">
          <span>Remote Access</span>
          <strong>{data.exposure.publicUrl ? 'Configured' : 'Setup needed'}</strong>
        </div>
        <RemoteAccessPanel status={data.exposure} onChanged={refresh} />
      </section>
      <section className="onboarding-block wide" data-onboarding-section="connect-ai">
        <div className="section-heading">
          <span>Connect an AI</span>
          <strong>Example guide</strong>
        </div>
        <p className="section-note">Examples only; provider screens can change.</p>
        <div className="endpoint">
          <span>MCP endpoint</span>
          <code>{endpoint}</code>
        </div>
        <div className="client-grid">
          {providers.map(([name, description]) => (
            <article className="client-example" key={name}>
              <h3>{name}</h3>
              <p>{description}</p>
              <p>
                Authentication: <b>OAuth</b>
              </p>
            </article>
          ))}
        </div>
      </section>
      <section className="onboarding-block" data-onboarding-section="workspace">
        <div className="section-heading">
          <span>Workspace</span>
          <strong>
            {data.workspaces.length ? `${data.workspaces.length} registered` : 'Register one'}
          </strong>
        </div>
        {data.workspaces.length ? (
          <p>Your local workspace is ready. Manage details from Workspaces.</p>
        ) : (
          <form
            className="stack-form"
            onSubmit={(event) => {
              event.preventDefault();
              void registerWorkspace(new FormData(event.currentTarget)).then(refresh);
            }}
          >
            <input name="name" placeholder="Workspace name" required />
            <input name="hostRoot" placeholder="Absolute path to your project" required />
            <button className="primary">Register workspace</button>
          </form>
        )}
      </section>
      <section className="onboarding-block" data-onboarding-section="try-aevra">
        <div className="section-heading">
          <span>Try Aevra</span>
          <strong>Start read-only</strong>
        </div>
        <p>
          Select a workspace from chat, approve access locally, then start with status, skills and
          file reads.
        </p>
      </section>
      <section
        className="onboarding-block wide onboarding-finish"
        data-onboarding-section="finish-onboarding"
      >
        <div>
          <b>
            {data.onboarding.completed
              ? 'Onboarding completed'
              : 'Finish onboarding when setup is ready'}
          </b>
        </div>
        <button
          type="button"
          className="primary"
          disabled={data.onboarding.completed}
          onClick={() => void completeOnboarding().then(refresh)}
        >
          {data.onboarding.completed ? 'Completed' : 'Finish onboarding'}
        </button>
      </section>
    </div>
  );
}

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
          <span>
            {selectedRows.length
              ? `${selectedRows.length} selected`
              : 'Select one or more connections to revoke'}
          </span>
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
            { key: 'capabilities', label: 'Capabilities' },
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
