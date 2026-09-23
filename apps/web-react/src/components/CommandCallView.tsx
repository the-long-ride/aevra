import { useState } from 'react';
import { tailLines, type CommandCall, type CommandResult } from './tool-call-format';

/** Output lines kept on screen before the reader asks for the whole stream. */
const OUTPUT_TAIL_LINES = 20;

function formatTimeout(ms: number) {
  return ms % 1000 === 0 ? `${ms / 1000}s` : `${ms} ms`;
}

export function CommandList({ commands }: { commands: CommandCall[] }) {
  return (
    <ol className="command-calls">
      {commands.map((command, index) => (
        <li key={index} className="command-call">
          <div className="command-call-head">
            {commands.length > 1 ? <span className="command-index">#{index + 1}</span> : null}
            {command.shell ? <span className="command-chip">{command.shell}</span> : null}
            {command.mode ? <span className="command-chip">{command.mode}</span> : null}
            {command.cwd ? (
              <span className="command-chip" title="Working directory">
                {command.cwd}
              </span>
            ) : null}
            {command.timeoutMs ? (
              <span className="command-chip">timeout {formatTimeout(command.timeoutMs)}</span>
            ) : null}
          </div>
          <pre className="command-line" data-testid="command-line">
            {command.line}
          </pre>
        </li>
      ))}
    </ol>
  );
}

function ExitBadge({ result }: { result: CommandResult }) {
  if (result.timedOut) return <span className="activity-state error">timed out</span>;
  if (result.exitCode !== undefined) {
    const tone = result.exitCode === 0 ? 'success' : 'error';
    return <span className={`activity-state ${tone}`}>exit {result.exitCode}</span>;
  }
  if (result.signal) return <span className="activity-state error">{result.signal}</span>;
  if (result.error) return <span className="activity-state error">failed</span>;
  return null;
}

function OutputStream({ name, text }: { name: 'stdout' | 'stderr'; text: string }) {
  const [showAll, setShowAll] = useState(false);
  const tail = tailLines(text, OUTPUT_TAIL_LINES);
  const shown = showAll ? text.replace(/\r?\n$/, '') : tail.text;
  const count =
    tail.hidden > 0 && !showAll
      ? `last ${OUTPUT_TAIL_LINES} of ${tail.total} lines`
      : `${tail.total} ${tail.total === 1 ? 'line' : 'lines'}`;

  return (
    <div className={`command-stream ${name}`} data-testid={`command-stream-${name}`}>
      <div className="command-stream-head">
        <span className="command-stream-name">{name}</span>
        <span className="command-stream-count">{count}</span>
        {tail.hidden > 0 ? (
          <button type="button" onClick={() => setShowAll((current) => !current)}>
            {showAll ? `Show last ${OUTPUT_TAIL_LINES}` : `Show all ${tail.total} lines`}
          </button>
        ) : null}
      </div>
      <pre>{shown}</pre>
    </div>
  );
}

export function CommandResultList({
  results,
  commands,
}: {
  results: CommandResult[];
  commands?: CommandCall[] | null;
}) {
  return (
    <ol className="command-calls">
      {results.map((result, index) => {
        const command = commands?.[index];
        const silent = !result.error && !result.stdout && !result.stderr;
        return (
          <li key={index} className="command-call" data-testid="command-result">
            <div className="command-call-head">
              {results.length > 1 ? <span className="command-index">#{index + 1}</span> : null}
              <ExitBadge result={result} />
              {result.durationMs !== undefined ? (
                <span className="command-chip">{result.durationMs} ms</span>
              ) : null}
              {command ? (
                <code className="command-call-title" title={command.line}>
                  {command.line}
                </code>
              ) : null}
            </div>
            {result.error ? (
              <p className="command-error" role="alert">
                {result.error}
              </p>
            ) : null}
            {result.stdout ? <OutputStream name="stdout" text={result.stdout} /> : null}
            {result.stderr ? <OutputStream name="stderr" text={result.stderr} /> : null}
            {silent ? <p className="command-empty">No output.</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
