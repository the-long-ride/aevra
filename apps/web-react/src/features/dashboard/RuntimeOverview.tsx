import type { DashboardData } from './dashboard-service';
import { McpDiagnosticsNotice } from './McpDiagnosticsNotice';

export type RuntimeModalKind = 'processes' | 'changes' | 'tools' | 'connectors';

export function RuntimeOverview({
  data,
  onOpen,
}: {
  data: DashboardData;
  onOpen(kind: RuntimeModalKind): void;
}) {
  const snapshot = data.snapshot;
  const rows: Array<{ label: string; value: unknown; modal?: RuntimeModalKind }> = [
    { label: 'Remote sessions', value: snapshot.stats.sessions },
    { label: 'Workspace leases', value: snapshot.stats.workspaceLeases },
    { label: 'Pending requests', value: snapshot.pending.total },
    { label: 'Managed processes', value: snapshot.stats.processes, modal: 'processes' },
    { label: 'Open changes', value: snapshot.stats.openChanges, modal: 'changes' },
    { label: 'Tool calls', value: snapshot.stats.toolCalls, modal: 'tools' },
    { label: 'Connectors', value: snapshot.stats.connectors, modal: 'connectors' },
  ];
  return (
    <>
      <McpDiagnosticsNotice snapshot={snapshot.status.mcpDiagnostics} />
      <div className="runtime-grid">
        {rows.map((row) =>
          row.modal ? (
            <button
              key={row.label}
              type="button"
              className="runtime-stat runtime-stat-button"
              onClick={() => onOpen(row.modal!)}
            >
              <span>{row.label}</span>
              <strong>{String(row.value)}</strong>
            </button>
          ) : (
            <div className="runtime-stat" key={row.label}>
              <span>{row.label}</span>
              <strong>{String(row.value)}</strong>
            </div>
          ),
        )}
      </div>
    </>
  );
}
