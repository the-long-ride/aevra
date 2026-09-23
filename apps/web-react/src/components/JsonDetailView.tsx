import { useState } from 'react';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type CopyState = 'idle' | 'copied' | 'failed';

/** Nodes at this depth and below start collapsed so big payloads open readable. */
const AUTO_COLLAPSE_DEPTH = 3;
/** Lines of a multi-line string shown before the reader asks for the rest. */
const MULTILINE_PREVIEW_LINES = 12;

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function primitiveClass(value: Exclude<JsonValue, JsonValue[] | { [key: string]: JsonValue }>) {
  if (value === null) return 'null';
  return typeof value;
}

/** Tool results often carry JSON serialized into a string; show it as a tree instead. */
function embeddedJson(value: string): JsonValue | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  const parsed = parseJson(trimmed);
  return parsed !== null && typeof parsed === 'object' ? parsed : undefined;
}

function PrimitiveValue({
  value,
}: {
  value: Exclude<JsonValue, JsonValue[] | { [key: string]: JsonValue }>;
}) {
  return (
    <span className={`json-detail-value ${primitiveClass(value)}`}>
      {value === null ? 'null' : String(value)}
    </span>
  );
}

function RowLabel({ name }: { name?: string }) {
  if (name === undefined) return null;
  return (
    <>
      <span className="json-detail-key">{name}</span>
      <span className="json-detail-separator">:</span>
    </>
  );
}

function MultilineString({ value, name, depth }: { value: string; name?: string; depth: number }) {
  const [showAll, setShowAll] = useState(false);
  const lines = value.split(/\r?\n/);
  const clamped = lines.length > MULTILINE_PREVIEW_LINES;
  const shown = showAll || !clamped ? value : lines.slice(0, MULTILINE_PREVIEW_LINES).join('\n');
  const style = { '--json-depth': depth } as React.CSSProperties;

  return (
    <div className="json-detail-node">
      <div className="json-detail-row" style={style}>
        <RowLabel name={name} />
        <span className="json-detail-summary">{lines.length} lines</span>
        {clamped ? (
          <button
            type="button"
            className="json-detail-more"
            onClick={() => setShowAll((current) => !current)}
          >
            {showAll
              ? `Show first ${MULTILINE_PREVIEW_LINES} lines`
              : `Show all ${lines.length} lines`}
          </button>
        ) : null}
      </div>
      <pre className="json-detail-multiline" style={style} data-testid="json-detail-multiline">
        {shown}
      </pre>
    </div>
  );
}

function JsonNode({ value, name, depth = 0 }: { value: JsonValue; name?: string; depth?: number }) {
  const embedded = typeof value === 'string' ? embeddedJson(value) : undefined;
  const node = embedded ?? value;
  const structured = Array.isArray(node) || isObject(node);
  const [expanded, setExpanded] = useState(depth < AUTO_COLLAPSE_DEPTH);

  if (!structured) {
    if (typeof node === 'string' && node.includes('\n')) {
      return <MultilineString value={node} name={name} depth={depth} />;
    }
    return (
      <div className="json-detail-row" style={{ '--json-depth': depth } as React.CSSProperties}>
        <RowLabel name={name} />
        <PrimitiveValue value={node} />
      </div>
    );
  }

  const entries: Array<[string, JsonValue]> = Array.isArray(node)
    ? node.map((item, index) => [String(index), item])
    : Object.entries(node);
  const displayName = name ?? 'root';
  const summary = Array.isArray(node) ? `[${entries.length}]` : `{${entries.length}}`;

  return (
    <div className="json-detail-node">
      <div className="json-detail-row" style={{ '--json-depth': depth } as React.CSSProperties}>
        <button
          type="button"
          className="json-detail-toggle"
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${displayName}`}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? '−' : '+'}
        </button>
        <RowLabel name={name} />
        <span className="json-detail-summary">{summary}</span>
        {embedded !== undefined ? <span className="json-detail-tag">JSON string</span> : null}
      </div>
      {expanded ? (
        <div className="json-detail-children">
          {entries.map(([key, child]) => (
            <JsonNode key={key} name={key} value={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function parseJson(value: string): JsonValue | undefined {
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return undefined;
  }
}

export function JsonDetailView({
  value,
  emptyText,
  label,
  copyValue,
  format = 'auto',
}: {
  value?: string;
  emptyText: string;
  label: string;
  /** Text the Copy button writes; defaults to the displayed value. */
  copyValue?: string;
  /** `raw` always shows the exact text instead of a tree. */
  format?: 'auto' | 'raw';
}) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const parsed = value === undefined || format === 'raw' ? undefined : parseJson(value);
  const isJson = parsed !== undefined;
  const formatLabel = format === 'raw' ? 'RAW' : isJson ? 'JSON' : 'TEXT';

  const copy = async () => {
    const text = copyValue ?? value;
    if (text === undefined) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  return (
    <div className="json-detail-view" data-json-label={label}>
      {value !== undefined ? (
        <div className="json-detail-toolbar">
          <span className="json-detail-format">{formatLabel}</span>
          <div className="json-detail-toolbar-actions">
            {copyState !== 'idle' ? (
              <span className={copyState === 'failed' ? 'json-copy-failed' : ''} role="status">
                {copyState === 'copied' ? 'Copied' : 'Copy failed'}
              </span>
            ) : null}
            <button
              type="button"
              aria-label={`Copy ${label} ${isJson ? 'JSON' : 'text'}`}
              onClick={() => void copy()}
            >
              Copy
            </button>
          </div>
        </div>
      ) : null}
      {isJson ? (
        <div className="json-detail-tree" data-testid="json-detail-tree">
          <JsonNode value={parsed} />
        </div>
      ) : (
        <pre className="json-detail-raw" data-testid="json-detail-raw">
          {value ?? emptyText}
        </pre>
      )}
    </div>
  );
}
