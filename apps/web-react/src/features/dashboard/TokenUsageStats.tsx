import type { TokenUsageReport } from '@aevra/admin-contracts';
import { formatTokens, savedShare } from './token-format';

interface Props {
  report: TokenUsageReport | null | undefined;
  error?: string | undefined;
}

const ESTIMATE_HINT =
  'Estimated by Aevra (heuristic-v1) from the text it relays. Not your model’s billed count.';

export function TokenUsageStats({ report, error }: Props) {
  if (!report) {
    return (
      <p className="token-usage-note" role="status">
        {error ? 'Token usage unavailable.' : 'Loading token usage…'}
      </p>
    );
  }
  const { today, topToolToday } = report;
  const perCall = today.calls
    ? Math.round((today.inputTokens + today.outputTokens) / today.calls)
    : 0;
  const boxes = [
    {
      id: 'out',
      label: 'Tokens out today',
      value: formatTokens(today.outputTokens),
      detail: `${today.calls} calls`,
    },
    {
      id: 'in',
      label: 'Tokens in today',
      value: formatTokens(today.inputTokens),
      detail: 'arguments received',
    },
    {
      id: 'saved',
      label: 'Saved today',
      value: formatTokens(today.savedTokens),
      detail: `${savedShare(today.savedTokens, today.outputTokens)}% less than raw`,
    },
    { id: 'avg', label: 'Avg tokens per call', value: formatTokens(perCall), detail: 'in + out' },
    {
      id: 'top',
      label: 'Top tool today',
      value: topToolToday?.tool ?? '—',
      detail: topToolToday ? `${formatTokens(topToolToday.outputTokens)} out` : '',
    },
  ];
  return (
    <section className="token-usage-stats" aria-label="Token usage today">
      <h3 className="token-usage-heading">
        Token usage <abbr title={ESTIMATE_HINT}>est.</abbr>
      </h3>
      <div className="token-usage-grid">
        {boxes.map((box) => (
          <div key={box.id} className="token-stat" data-stat={box.id}>
            <span className="token-stat-label">{box.label}</span>
            <strong className="token-stat-value">{box.value}</strong>
            <span className="token-stat-detail">{box.detail}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
