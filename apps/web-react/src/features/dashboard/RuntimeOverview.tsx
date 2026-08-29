import type { DashboardData } from './dashboard-service';
import { McpDiagnosticsNotice } from './McpDiagnosticsNotice';
import { RequestActivityChart } from './RequestActivityChart';

export type RuntimeModalKind = 'processes' | 'changes' | 'tools' | 'connectors';

export function RuntimeOverview({
  data,
  onOpen,
  onOpenPending,
  onOpenTransport,
}: {
  data: DashboardData;
  onOpen(kind: RuntimeModalKind): void;
  onOpenPending(): void;
  onOpenTransport(): void;
}) {
  const snapshot = data.snapshot;
  const power = snapshot.power;
  const transport = snapshot.transport;
  const transportValue = transport
    ? transport.state === 'secure'
      ? 'Secure'
      : transport.state === 'local-http'
        ? 'Local HTTP'
        : transport.state === 'action-required'
          ? 'Action required'
          : 'Unavailable'
    : 'Unavailable';
  const powerValue = power
    ? power.supported
      ? power.reason
      : `Unavailable${power.message ? ` · ${power.message}` : ''}`
    : 'Unavailable';
  const rows: Array<{
    label: string;
    value: unknown;
    modal?: RuntimeModalKind;
    pending?: boolean;
    transport?: boolean;
    compact?: boolean;
    powerState?: 'active' | 'inactive';
  }> = [
    { label: 'Remote sessions', value: snapshot.stats.sessions },
    { label: 'Workspace leases', value: snapshot.stats.workspaceLeases },
    { label: 'Pending requests', value: snapshot.pending.total, pending: true },
    {
      label: 'Transport',
      value: transportValue,
      transport: true,
      compact: true,
    },
    {
      label: 'Sleep inhibition',
      value: powerValue,
      compact: true,
      powerState: power?.supported && power.active ? 'active' : 'inactive',
    },
    { label: 'Managed processes', value: snapshot.stats.processes, modal: 'processes' },
    { label: 'Open changes', value: snapshot.stats.openChanges, modal: 'changes' },
    { label: 'Tool calls', value: snapshot.stats.toolCalls, modal: 'tools' },
    { label: 'Connectors', value: snapshot.stats.connectors, modal: 'connectors' },
  ];
  return (
    <>
      <McpDiagnosticsNotice snapshot={snapshot.status.mcpDiagnostics} />
      <div className="runtime-grid">
        {rows.map((row) => {
          const content = (
            <>
              <span>{row.label}</span>
              {row.powerState ? (
                <i
                  className={`runtime-stat-status-dot ${row.powerState}`}
                  aria-label={row.powerState === 'active' ? 'Enabled' : 'Disabled'}
                  title={row.powerState === 'active' ? 'Enabled' : 'Disabled'}
                />
              ) : null}
              <strong className={row.compact ? 'runtime-stat-detail' : undefined}>
                {String(row.value)}
              </strong>
            </>
          );
          return row.modal || row.pending || row.transport ? (
            <button
              key={row.label}
              type="button"
              className={`runtime-stat runtime-stat-button${row.compact ? ' runtime-stat-compact' : ''}`}
              onClick={
                row.pending
                  ? onOpenPending
                  : row.transport
                    ? onOpenTransport
                    : () => onOpen(row.modal!)
              }
            >
              {content}
            </button>
          ) : (
            <div
              className={`runtime-stat${row.compact ? ' runtime-stat-compact' : ''}`}
              key={row.label}
            >
              {content}
            </div>
          );
        })}
      </div>
      <RequestActivityChart data={data} />
    </>
  );
}
