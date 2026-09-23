import type { McpActivityEntry } from '@aevra/admin-contracts';
import { useId } from 'react';
import { DetailModeToggle, ToolCallView, useDetailMode } from '../../components/ToolCallView';

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2).replace(/\.?0+$/, '')} s`;
}

export function ActivityDetailBody({
  entry,
  clientName,
  workspaceLabel,
}: {
  entry: McpActivityEntry;
  clientName: string;
  workspaceLabel: string;
}) {
  const [mode, setMode] = useDetailMode();
  const inputId = useId();
  const outputId = useId();
  const finished = entry.state !== 'running';

  return (
    <div className="activity-detail">
      <div className="activity-detail-meta">
        <code className="activity-detail-action">{entry.action}</code>
        <span className={`activity-state ${entry.state}`}>{entry.state.toUpperCase()}</span>
        <span>{clientName}</span>
        <span>{workspaceLabel}</span>
        {finished && entry.durationMs !== undefined ? (
          <span>{formatDuration(entry.durationMs)}</span>
        ) : null}
        <time dateTime={entry.startedAt}>{new Date(entry.startedAt).toLocaleString()}</time>
        <DetailModeToggle mode={mode} onChange={setMode} />
      </div>
      <div className="activity-detail-columns">
        <section aria-labelledby={inputId}>
          <h3 id={inputId}>Input</h3>
          <ToolCallView
            side="input"
            action={entry.action}
            mode={mode}
            raw={entry.input}
            emptyText="No input recorded."
          />
        </section>
        <section aria-labelledby={outputId}>
          <h3 id={outputId}>Output</h3>
          <ToolCallView
            side="output"
            action={entry.action}
            mode={mode}
            raw={entry.output}
            input={entry.input}
            emptyText={finished ? 'No output recorded.' : 'Still running.'}
          />
        </section>
      </div>
    </div>
  );
}
