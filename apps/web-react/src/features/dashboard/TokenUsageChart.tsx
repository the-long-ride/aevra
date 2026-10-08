import type { TokenUsageRange, TokenUsageReport } from '@aevra/admin-contracts';
import { useState } from 'react';
import { formatTokens } from './token-format';
import { layoutBars, niceMax } from './token-usage-geometry';

const RANGES: ReadonlyArray<{ id: TokenUsageRange; label: string }> = [
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: '90d', label: '90d' },
  { id: 'all', label: 'All' },
];
const PLOT = { width: 640, height: 160 };

interface Props {
  report: TokenUsageReport | null | undefined;
  range: TokenUsageRange;
  onRangeChange: (range: TokenUsageRange) => void;
}

function periodLabel(start: string, granularity: 'hour' | 'day'): string {
  const date = new Date(start);
  return granularity === 'hour'
    ? date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function TokenUsageChart({ report, range, onRangeChange }: Props) {
  const [active, setActive] = useState<number | undefined>();
  const series = report?.series ?? [];
  const peak = series.reduce(
    (max, b) => Math.max(max, b.inputTokens + b.outputTokens, b.savedTokens),
    0,
  );
  const max = niceMax(peak);
  const bars = layoutBars(series, PLOT, max);
  const empty = !report || report.totals.calls === 0;
  const granularity = report?.granularity ?? 'hour';
  const current = active === undefined ? undefined : series[active];
  const status = current
    ? `${periodLabel(current.start, granularity)}: ${formatTokens(current.outputTokens)} out · ${formatTokens(current.inputTokens)} in · ${formatTokens(current.savedTokens)} saved (est.)`
    : report
      ? `${formatTokens(report.totals.outputTokens)} out, ${formatTokens(report.totals.inputTokens)} in over this range (est.)`
      : '';
  const saved = bars.map((bar) => `${bar.x + bar.width / 2},${bar.savedY}`).join(' ');

  return (
    <section className="token-usage-chart" aria-label="Token usage history">
      <div className="token-usage-chart-head">
        <h3 className="token-usage-heading">Token usage history</h3>
        <div className="token-usage-ranges" role="group" aria-label="Range">
          {RANGES.map((item) => (
            <button
              key={item.id}
              type="button"
              className="token-usage-range"
              aria-pressed={item.id === range}
              onClick={() => {
                setActive(undefined);
                onRangeChange(item.id);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {empty ? (
        <p className="token-usage-note">No token usage recorded yet.</p>
      ) : (
        <>
          <svg
            className="token-usage-svg"
            viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
            role="img"
            aria-label={`Token usage per ${granularity}, estimated. Axis maximum ${formatTokens(max)}.`}
            preserveAspectRatio="none"
          >
            {bars.map((bar, index) => (
              <g
                key={series[index]!.start}
                data-testid="token-bar"
                tabIndex={0}
                onMouseEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onMouseLeave={() => setActive(undefined)}
                onBlur={() => setActive(undefined)}
              >
                <rect
                  className="token-bar-hit"
                  x={bar.x}
                  y={0}
                  width={bar.width}
                  height={PLOT.height}
                />
                <rect
                  className="token-bar-out"
                  x={bar.x}
                  y={PLOT.height - bar.outputH - bar.inputH}
                  width={bar.width}
                  height={bar.outputH}
                />
                <rect
                  className="token-bar-in"
                  x={bar.x}
                  y={PLOT.height - bar.inputH}
                  width={bar.width}
                  height={bar.inputH}
                />
              </g>
            ))}
            <polyline className="token-line-saved" points={saved} fill="none" />
          </svg>
          <div className="token-usage-chart-footer">
            <div className="token-usage-legend" aria-hidden="true">
              <span className="token-key token-key-out">out</span>
              <span className="token-key token-key-in">in</span>
              <span className="token-key token-key-saved">saved</span>
              <span>max {formatTokens(max)}</span>
            </div>
            <p className="token-usage-note" role="status">
              {status}
            </p>
          </div>
          <table className="sr-only">
            <caption>Token usage by period (estimated)</caption>
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col">Out</th>
                <th scope="col">In</th>
                <th scope="col">Saved</th>
              </tr>
            </thead>
            <tbody>
              {series
                .filter((b) => b.calls > 0)
                .map((b) => (
                  <tr key={b.start}>
                    <th scope="row">{periodLabel(b.start, granularity)}</th>
                    <td>{b.outputTokens}</td>
                    <td>{b.inputTokens}</td>
                    <td>{b.savedTokens}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
