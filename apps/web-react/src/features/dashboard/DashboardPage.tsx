import type { ConnectorSummary } from '@aevra/admin-contracts';
import { useCallback, useEffect, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { PageState } from '../../components/PageState';
import { requestJson } from '../../services/api-client';
import { dashboardOrder } from './dashboard-order';
import {
  completeOnboarding,
  loadDashboard,
  registerWorkspace,
  type DashboardData,
} from './dashboard-service';
import { DashboardSection } from './DashboardSection';
import { RemoteAccessPanel } from './RemoteAccessPanel';

function RuntimeOverview({ data }: { data: DashboardData }) {
  const snapshot = data.snapshot;
  const rows = [
    ['Version', snapshot.status.version ?? '—'],
    ['Remote sessions', snapshot.stats.sessions],
    ['Workspace leases', snapshot.stats.workspaceLeases],
    ['Pending requests', snapshot.pending.total],
    ['Managed processes', snapshot.stats.processes],
    ['Open changes', snapshot.stats.openChanges],
    ['Tool calls', snapshot.stats.toolCalls],
    ['Connectors', snapshot.stats.connectors],
  ];
  return (
    <div className="runtime-grid">
      {rows.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{String(value)}</strong>
        </div>
      ))}
    </div>
  );
}

function Onboarding({
  data,
  refresh,
}: {
  data: DashboardData;
  refresh(): Promise<void>;
}) {
  const endpoint = data.cloudflare.hostname
    ? `https://${data.cloudflare.hostname}/mcp`
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
          <strong>{data.cloudflare.hostname ? 'Configured' : 'Setup needed'}</strong>
        </div>
        <RemoteAccessPanel status={data.cloudflare} onChanged={refresh} />
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
            {data.workspaces.length
              ? `${data.workspaces.length} registered`
              : 'Register one'}
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
          Select a workspace from chat, approve access locally, then start with status,
          skills and file reads.
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
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await loadDashboard());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const next = await loadDashboard();
        if (!stopped) {
          setData(next);
          setError(null);
        }
      } catch (cause) {
        if (!stopped) {
          setError(cause instanceof Error ? cause : new Error(String(cause)));
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!data) {
    return <PageState loading={!error} error={error}>Dashboard</PageState>;
  }

  const revokeConnector = async (connector: ConnectorSummary) => {
    if (!window.confirm(`Revoke ${connector.name}?`)) return;
    await requestJson(`/api/connectors/${connector.id}`, { method: 'DELETE' });
    await refresh();
  };

  const createConnector = async () => {
    const name = window.prompt('Connector name');
    if (!name?.trim()) return;
    const created = await requestJson<{ token: string }>('/api/connectors', {
      method: 'POST',
      body: JSON.stringify({ name: name.trim() }),
    });
    window.alert(`Copy this token now. It is shown once.\n\n${created.token}`);
    await refresh();
  };

  const sections = {
    onboarding: (
      <DashboardSection key="onboarding" id="onboarding" title="Onboarding">
        <Onboarding data={data} refresh={refresh} />
      </DashboardSection>
    ),
    'runtime-overview': (
      <DashboardSection key="runtime" id="runtime-overview" title="Runtime overview">
        <RuntimeOverview data={data} />
      </DashboardSection>
    ),
    'active-connections': (
      <DashboardSection key="active" id="active-connections" title="Active connections">
        <DataTable
          id="react-dashboard-active"
          rows={data.snapshot.activeConnections}
          pageSize={10}
          filters={[
            { key: 'authType', label: 'Auth' },
            { key: 'status', label: 'Status' },
          ]}
          columns={[
            { key: 'client', label: 'Client' },
            { key: 'authType', label: 'Auth' },
            { key: 'workspace', label: 'Workspace' },
            { key: 'capabilities', label: 'Capabilities' },
            { key: 'lastActivityAt', label: 'Last activity' },
          ]}
          emptyText="No active remote connections."
        />
      </DashboardSection>
    ),
    'tool-activity': (
      <DashboardSection key="tools" id="tool-activity" title="Tool activity">
        <DataTable
          id="react-dashboard-tools"
          rows={data.snapshot.metrics}
          columns={[
            { key: 'tool', label: 'Tool' },
            { key: 'calls', label: 'Calls' },
            { key: 'avgMs', label: 'Avg latency' },
            { key: 'totalMs', label: 'Total time' },
          ]}
          emptyText="No tool calls recorded in this runtime."
        />
      </DashboardSection>
    ),
    connections: (
      <DashboardSection key="connections" id="connections" title="Connections">
        <div className="panel-toolbar">
          <p>OAuth is recommended. Static Bearer connectors remain available when needed.</p>
          <button type="button" onClick={() => void createConnector()}>
            New connector
          </button>
        </div>
        <DataTable
          id="react-dashboard-connectors"
          rows={data.snapshot.connectors}
          columns={[
            { key: 'name', label: 'Connector' },
            { key: 'createdAt', label: 'Created' },
            { key: 'lastUsedAt', label: 'Last used' },
            {
              key: 'actions',
              label: '',
              sortable: false,
              search: false,
              render: (row) => (
                <button type="button" onClick={() => void revokeConnector(row)}>
                  Revoke
                </button>
              ),
            },
          ]}
        />
      </DashboardSection>
    ),
    'recent-activity': (
      <DashboardSection key="recent" id="recent-activity" title="Recent activity">
        <div className="recent-grid">
          {[
            ['Requests', data.snapshot.pending.total],
            ['Sessions', data.snapshot.stats.sessions],
            ['Processes', data.snapshot.stats.processes],
            ['Changes', data.snapshot.stats.openChanges],
          ].map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{String(value)}</strong>
            </div>
          ))}
        </div>
      </DashboardSection>
    ),
  };

  return (
    <>
      <section className="page-head">
        <div>
          <h2>Dashboard</h2>
          <p>Local gateway runtime, connections, requests, and onboarding.</p>
        </div>
      </section>
      {dashboardOrder(data.onboarding.completed).map((id) => sections[id])}
    </>
  );
}
