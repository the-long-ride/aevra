import { useCallback, useState } from 'react';
import { CommandList, CommandResultList } from './CommandCallView';
import { JsonDetailView } from './JsonDetailView';
import {
  extractCommandResults,
  extractCommands,
  parseDetail,
  unwrapMcpResult,
} from './tool-call-format';

export type DetailMode = 'pretty' | 'raw';

const MODE_STORAGE_KEY = 'aevra.toolCallDetailMode';

function readMode(): DetailMode {
  try {
    return localStorage.getItem(MODE_STORAGE_KEY) === 'raw' ? 'raw' : 'pretty';
  } catch {
    return 'pretty';
  }
}

/** Pretty/raw choice, remembered per browser so the reader's preference sticks. */
export function useDetailMode() {
  const [mode, setMode] = useState<DetailMode>(readMode);
  const update = useCallback((next: DetailMode) => {
    setMode(next);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // Storage can be blocked; the choice still applies for this view.
    }
  }, []);
  return [mode, update] as const;
}

export function DetailModeToggle({
  mode,
  onChange,
}: {
  mode: DetailMode;
  onChange(mode: DetailMode): void;
}) {
  return (
    <div className="detail-mode-toggle" role="group" aria-label="Detail view">
      {(['pretty', 'raw'] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={mode === option}
          className={mode === option ? 'active' : undefined}
          onClick={() => onChange(option)}
        >
          {option === 'pretty' ? 'Pretty' : 'Raw'}
        </button>
      ))}
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(data: unknown): string | undefined {
  if (!isRecord(data) || !isRecord(data.error)) return undefined;
  const { code, message } = data.error;
  return [code, message].filter((part) => typeof part === 'string' && part).join(': ') || undefined;
}

interface ToolCallViewProps {
  side: 'input' | 'output';
  action: string;
  mode: DetailMode;
  /** The recorded payload string exactly as the activity log stored it. */
  raw?: string;
  /** The recorded input, so output cards can name the command they belong to. */
  input?: string;
  label?: string;
  emptyText?: string;
}

export function ToolCallView({
  side,
  action,
  mode,
  raw,
  input,
  label = side === 'input' ? 'Input' : 'Output',
  emptyText = 'Nothing recorded.',
}: ToolCallViewProps) {
  if (mode === 'raw') {
    return <JsonDetailView label={label} value={raw} format="raw" emptyText={emptyText} />;
  }

  const parsed = parseDetail(raw);
  if (!parsed) return <JsonDetailView label={label} emptyText={emptyText} />;

  const note = parsed.truncated ? (
    <p className="tool-call-note">
      Truncated by the server at its size limit. Raw shows exactly what was kept.
    </p>
  ) : null;

  if (!parsed.ok) {
    return (
      <div className="tool-call-view">
        {note}
        <JsonDetailView label={label} value={parsed.text} copyValue={raw} emptyText={emptyText} />
      </div>
    );
  }

  const { data } = side === 'output' ? unwrapMcpResult(parsed.value) : { data: parsed.value };
  let body: React.ReactNode = null;
  if (side === 'input') {
    const commands = extractCommands(action, data);
    if (commands) body = <CommandList commands={commands} />;
  } else {
    const results = extractCommandResults(action, data);
    if (results) {
      const recordedInput = parseDetail(input);
      const commands = recordedInput?.ok ? extractCommands(action, recordedInput.value) : null;
      body = <CommandResultList results={results} commands={commands} />;
    }
  }

  const error = body ? undefined : errorMessage(data);
  body ??= (
    <JsonDetailView
      label={label}
      value={typeof data === 'string' ? data : JSON.stringify(data, null, 2)}
      copyValue={raw}
      emptyText={emptyText}
    />
  );

  return (
    <div className="tool-call-view">
      {note}
      {error ? (
        <p className="tool-call-error" role="alert">
          {error}
        </p>
      ) : null}
      {body}
    </div>
  );
}
