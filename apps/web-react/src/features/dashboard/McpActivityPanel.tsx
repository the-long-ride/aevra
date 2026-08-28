import type { McpActivityEntry, WorkspaceSummary } from '@aevra/admin-contracts';
import { useMemo } from 'react';
import { DataTable } from '../../components/DataTable';
import { JsonDetailView } from '../../components/JsonDetailView';
import { useDialog } from '../../components/Dialog';
import {
  McpActivityProvider,
  useHasMcpActivityProvider,
  useMcpActivity,
} from '../../hooks/use-mcp-activity';

function clientLabel(actor: string) {
  return actor.replace(/^(oauth:|connector:)/, '') || actor;
}

function McpActivityPanelContent({ workspaces }: { workspaces: WorkspaceSummary[] }) {
  const { entries, streamState } = useMcpActivity();
  const dialog = useDialog();
  const workspaceNames = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
    [workspaces],
  );
  const workspaceLabel = (entry: McpActivityEntry) =>
    entry.workspaceId ? (workspaceNames.get(entry.workspaceId) ?? entry.workspaceId) : '—';

  const showDetails = (entry: McpActivityEntry) =>
    dialog.message({
      title: 'MCP activity details',
      actionLabel: 'Close',
      message: (
        <div className="activity-detail">
          <div className="activity-detail-meta">
            <span>{clientLabel(entry.actor)}</span>
            <span>{workspaceLabel(entry)}</span>
            <code>{entry.action}</code>
          </div>
          <section>
            <b>Input</b>
            <JsonDetailView label="Input" value={entry.input} emptyText="No input recorded." />
          </section>
          <section>
            <b>Output</b>
            <JsonDetailView
              label="Output"
              value={entry.output}
              emptyText={entry.state === 'running' ? 'Still running.' : 'No output recorded.'}
            />
          </section>
        </div>
      ),
    });

  return (
    <div className="mcp-activity-panel">
      <div className="live-activity-head">
        <p>Live MCP lifecycle with bounded detail payloads. Sensitive values are redacted.</p>
        <span className={`activity-stream-state ${streamState}`}>
          {streamState === 'live'
            ? 'LIVE'
            : streamState === 'unsupported'
              ? 'UNAVAILABLE'
              : streamState.toUpperCase()}
        </span>
      </div>
      <DataTable
        id="react-dashboard-mcp-activity"
        rows={entries}
        pageSize={10}
        searchPlaceholder="Search MCP activity…"
        rowKey={(entry) => entry.id}
        emptyText="No MCP activity yet."
        filters={[
          { key: 'client', label: 'Client', value: (entry) => clientLabel(entry.actor) },
          { key: 'workspace', label: 'Workspace', value: workspaceLabel },
          { key: 'kind', label: 'Type', format: (value) => String(value).toUpperCase() },
          { key: 'state', label: 'Status', format: (value) => String(value).toUpperCase() },
        ]}
        columns={[
          { key: 'updatedAt', label: 'Time', sortable: false, search: false, dateTime: true },
          {
            key: 'client',
            label: 'Client',
            sortable: false,
            value: (entry) => clientLabel(entry.actor),
          },
          { key: 'workspace', label: 'Workspace', sortable: false, value: workspaceLabel },
          { key: 'kind', label: 'Type', sortable: false },
          {
            key: 'action',
            label: 'Action',
            sortable: false,
            render: (entry) => <code>{entry.action}</code>,
          },
          {
            key: 'state',
            label: 'Status',
            sortable: false,
            render: (entry) => (
              <span className={`activity-state ${entry.state}`}>{entry.state.toUpperCase()}</span>
            ),
          },
          {
            key: 'durationMs',
            label: 'Duration',
            sortable: false,
            search: false,
            render: (entry) => (entry.state === 'running' ? '—' : `${entry.durationMs ?? 0} ms`),
          },
          {
            key: 'details',
            label: 'Actions',
            sortable: false,
            search: false,
            render: (entry) => (
              <button type="button" onClick={() => void showDetails(entry)}>
                Details
              </button>
            ),
          },
        ]}
      />
    </div>
  );
}

export function McpActivityPanel({ workspaces }: { workspaces: WorkspaceSummary[] }) {
  const hasProvider = useHasMcpActivityProvider();
  return hasProvider ? (
    <McpActivityPanelContent workspaces={workspaces} />
  ) : (
    <McpActivityProvider>
      <McpActivityPanelContent workspaces={workspaces} />
    </McpActivityProvider>
  );
}
