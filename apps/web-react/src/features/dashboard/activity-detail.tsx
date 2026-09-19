import type { McpActivityEntry, WorkspaceSummary } from '@aevra/admin-contracts';
import type { DialogApi } from '../../components/Dialog';
import { JsonDetailView } from '../../components/JsonDetailView';

export function clientLabel(actor: string): string {
  return actor.replace(/^(oauth:|connector:)/, '') || actor;
}

export interface ConnectorGroup {
  connector: string;
  entries: McpActivityEntry[];
}

export function groupEntriesByConnector(entries: McpActivityEntry[]): ConnectorGroup[] {
  const map = new Map<string, McpActivityEntry[]>();
  for (const entry of entries) {
    const connector = clientLabel(entry.actor) || 'Unknown';
    const list = map.get(connector);
    if (list) {
      list.push(entry);
    } else {
      map.set(connector, [entry]);
    }
  }
  return Array.from(map.entries()).map(([connector, groupEntries]) => ({
    connector,
    entries: groupEntries,
  }));
}

export function showMcpActivityDetails(
  dialog: DialogApi,
  entry: McpActivityEntry,
  workspaces: WorkspaceSummary[] = [],
): Promise<void> {
  const workspaceNames = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));
  const workspaceLabel = entry.workspaceId
    ? (workspaceNames.get(entry.workspaceId) ?? entry.workspaceId)
    : '—';

  return dialog.message({
    title: 'MCP activity details',
    actionLabel: 'Close',
    message: (
      <div className="activity-detail">
        <div className="activity-detail-meta">
          <span>{clientLabel(entry.actor)}</span>
          <span>{workspaceLabel}</span>
          <code>{entry.action}</code>
          <span className={`activity-state ${entry.state}`}>{entry.state.toUpperCase()}</span>
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
}
