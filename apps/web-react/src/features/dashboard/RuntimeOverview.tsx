import { useMemo } from 'react';
import { useMcpActivityEntries, type McpActivityEntry } from '../../hooks/use-mcp-activity';
import type { DashboardData } from './dashboard-service';
import { McpDiagnosticsNotice } from './McpDiagnosticsNotice';

export type RuntimeModalKind = 'processes' | 'changes' | 'tools' | 'connectors';

interface RequestPoint {
  timestamp: number;
  active: number;
}

function buildRequestHistory(entries: McpActivityEntry[], generatedAt: string) {
  const parsedEnd = Date.parse(generatedAt);
  const end = Number.isFinite(parsedEnd) ? parsedEnd : Date.now();
  const starts = entries.map((entry) => Date.parse(entry.startedAt)).filter(Number.isFinite);
  const start = starts.length ? Math.min(...starts, end) : end;
  const events: Array<{ timestamp: number; delta: number }> = [];

  for (const entry of entries) {
    if (entry.kind === 'session') continue;
    const entryStart = Date.parse(entry.startedAt);
    if (Number.isFinite(entryStart) && entryStart >= start && entryStart <= end) {
      events.push({ timestamp: entryStart, delta: 1 });
    }
    if (entry.state !== 'running') {
      const entryEnd = Date.parse(entry.updatedAt);
      if (Number.isFinite(entryEnd) && entryEnd >= start && entryEnd <= end) {
        events.push({ timestamp: entryEnd, delta: -1 });
      }
    }
  }

  events.sort((a, b) => a.timestamp - b.timestamp || b.delta - a.delta);
  const points: RequestPoint[] = [{ timestamp: start, active: 0 }];
  let active = 0;
  for (const event of events) {
    active = Math.max(0, active + event.delta);
    const previous = points[points.length - 1];
    if (previous?.timestamp === event.timestamp) previous.active = active;
    else points.push({ timestamp: event.timestamp, active });
  }
  if (points[points.length - 1]?.timestamp !== end) {
    points.push({ timestamp: end, active });
  }
  return points;
}

function RequestActivityChart({ data }: { data: DashboardData }) {
  const entries = useMcpActivityEntries();
  const snapshot = data.snapshot as typeof data.snapshot & {
    startedAt?: string;
    generatedAt?: string;
  };
  const generatedAt = snapshot.generatedAt ?? new Date().toISOString();
  const points = useMemo(() => buildRequestHistory(entries, generatedAt), [entries, generatedAt]);
  const width = 720;
  const height = 180;
  const left = 34;
  const right = 12;
  const top = 12;
  const bottom = 28;
  const start = points[0]?.timestamp ?? Date.now();
  const end = Math.max(points[points.length - 1]?.timestamp ?? start, start + 1);
  const maxActive = Math.max(1, ...points.map((point) => point.active));
  const x = (timestamp: number) =>
    left + ((timestamp - start) / (end - start)) * (width - left - right);
  const y = (active: number) => top + ((maxActive - active) / maxActive) * (height - top - bottom);
  const stepPoints: Array<[number, number]> = [];
  points.forEach((point, index) => {
    const px = x(point.timestamp);
    const py = y(point.active);
    const previous = points[index - 1];
    if (previous) stepPoints.push([px, y(previous.active)]);
    stepPoints.push([px, py]);
  });
  const polyline = stepPoints.map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`).join(' ');
  const current = points[points.length - 1]?.active ?? 0;

  return (
    <section className="runtime-request-chart" aria-label="Active requests over runtime">
      <div className="runtime-request-chart-head">
        <div>
          <span>Request activity</span>
          <strong>{current} active now</strong>
        </div>
        <small>Recent activity · live MCP stream</small>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Active requests by timestamp">
        <line x1={left} y1={top} x2={left} y2={height - bottom} className="runtime-chart-axis" />
        <line
          x1={left}
          y1={height - bottom}
          x2={width - right}
          y2={height - bottom}
          className="runtime-chart-axis"
        />
        <line x1={left} y1={top} x2={width - right} y2={top} className="runtime-chart-grid" />
        <polyline points={polyline} className="runtime-chart-line" fill="none" />
        <text x={left} y={height - 8} className="runtime-chart-label">
          {new Date(start).toLocaleTimeString()}
        </text>
        <text x={width - right} y={height - 8} textAnchor="end" className="runtime-chart-label">
          {new Date(end).toLocaleTimeString()}
        </text>
        <text x={left + 5} y={top + 12} className="runtime-chart-label">
          {maxActive}
        </text>
        <text x={left + 5} y={height - bottom - 5} className="runtime-chart-label">
          0
        </text>
      </svg>
    </section>
  );
}

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
