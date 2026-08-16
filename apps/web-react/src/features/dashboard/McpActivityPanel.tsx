import type { McpActivityEntry, WorkspaceSummary } from '@aevra/admin-contracts';
import { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { useDialog } from '../../components/Dialog';

type StreamState = 'connecting' | 'live' | 'reconnecting' | 'unsupported';

function clientLabel(actor: string) {
  return actor.replace(/^(oauth:|connector:)/, '') || actor;
}

function mergeActivity(current: McpActivityEntry[], incoming: McpActivityEntry) {
  const next = new Map(current.map((entry) => [entry.id, entry]));
  next.set(incoming.id, incoming);
  return [...next.values()]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, 100);
}

function validEntry(value: unknown): value is McpActivityEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<McpActivityEntry>;
  return Boolean(
    entry.id &&
    entry.actor &&
    entry.sessionId &&
    entry.action &&
    entry.updatedAt &&
    ['tool', 'rpc', 'session'].includes(String(entry.kind)) &&
    ['running', 'success', 'error'].includes(String(entry.state)),
  );
}

export function McpActivityPanel({ workspaces }: { workspaces: WorkspaceSummary[] }) {
  const [entries, setEntries] = useState<McpActivityEntry[]>([]);
  const [streamState, setStreamState] = useState<StreamState>('connecting');
  const dialog = useDialog();
  const workspaceNames = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
    [workspaces],
  );
  const workspaceLabel = (entry: McpActivityEntry) =>
    entry.workspaceId ? (workspaceNames.get(entry.workspaceId) ?? entry.workspaceId) : '—';

  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      setStreamState('unsupported');
      return undefined;
    }

    const source = new EventSource('/api/activity/stream');
    source.onopen = () => setStreamState('live');
    source.onerror = () => setStreamState('reconnecting');
    source.addEventListener('activity', (event) => {
      try {
        const parsed: unknown = JSON.parse((event as MessageEvent<string>).data);
        if (validEntry(parsed)) setEntries((current) => mergeActivity(current, parsed));
      } catch {
        // Ignore malformed stream events. The stream itself remains connected.
      }
    });
    return () => source.close();
  }, []);

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
            <pre>{entry.input ?? 'No input recorded.'}</pre>
          </section>
          <section>
            <b>Output</b>
            <pre>
              {entry.output ??
                (entry.state === 'running' ? 'Still running.' : 'No output recorded.')}
            </pre>
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
