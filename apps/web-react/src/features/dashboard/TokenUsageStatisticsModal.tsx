import type { TokenUsageReport } from '@aevra/admin-contracts';
import { ManagementModal } from '../../components/ManagementModal';
import { useTokenUsage } from '../../hooks/use-token-usage';
import { formatTokens, savedShare } from './token-format';

function Statistics({ report }: { report: TokenUsageReport }) {
  const { totals } = report;
  const metrics = [
    ['Input tokens', totals.inputTokens],
    ['Output tokens', totals.outputTokens],
    ['Saved tokens', totals.savedTokens],
    ['Calls', totals.calls],
    [
      'Average tokens per call',
      totals.calls ? Math.round((totals.inputTokens + totals.outputTokens) / totals.calls) : 0,
    ],
    ['Failed calls', totals.errors],
  ] as const;
  return (
    <>
      <p className="token-usage-note">
        Estimated by Aevra (heuristic-v1) across recorded history; these are not your provider's
        billed counts.
      </p>
      {totals.calls === 0 ? <p className="token-usage-note">No token usage recorded yet.</p> : null}
      <div className="token-usage-grid">
        {metrics.map(([label, value]) => (
          <div key={label} className="token-stat" aria-label={label}>
            <span className="token-stat-label">{label}</span>
            <strong className="token-stat-value" title={value.toLocaleString()}>
              {formatTokens(value)}
              {label === 'Saved tokens' ? (
                <span className="token-stat-share">
                  {' '}
                  ~ {savedShare(totals.savedTokens, totals.outputTokens)}%
                </span>
              ) : null}
            </strong>
          </div>
        ))}
      </div>
      <Breakdown
        title="Top tools (up to 10)"
        rows={report.byTool.map((row) => ({ ...row, name: row.tool }))}
      />
      <Breakdown
        title="Connectors"
        rows={report.byConnector.map((row) => ({ ...row, name: row.label, id: row.connector }))}
      />
    </>
  );
}

function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: Array<{
    id?: string;
    name: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    savedTokens: number;
  }>;
}) {
  return (
    <section className="token-statistics-breakdown" aria-label={title}>
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="token-usage-note">No breakdown recorded yet.</p>
      ) : (
        <div className="token-statistics-table-scroll">
          <table>
            <caption className="sr-only">{title} - estimated tokens</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Calls</th>
                <th scope="col">Input</th>
                <th scope="col">Output</th>
                <th scope="col">Saved</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id ?? row.name}>
                  <th scope="row">{row.name}</th>
                  {[row.calls, row.inputTokens, row.outputTokens, row.savedTokens].map(
                    (value, index) => (
                      <td key={index}>{value.toLocaleString()}</td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function TokenUsageStatisticsModal({ onClose }: { onClose(): void }) {
  const usage = useTokenUsage('all');
  return (
    <ManagementModal open title="All-time token statistics" onClose={onClose}>
      <div className="token-statistics-content">
        {usage.error ? (
          <div role="alert">
            <p>All-time statistics unavailable: {usage.error.message}</p>
            <button type="button" onClick={() => void usage.refresh()}>
              Retry
            </button>
          </div>
        ) : null}
        {usage.data ? (
          <Statistics report={usage.data} />
        ) : !usage.error ? (
          <p role="status">Loading all-time statistics…</p>
        ) : null}
      </div>
    </ManagementModal>
  );
}
