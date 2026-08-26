import { useState } from 'react';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type CopyState = 'idle' | 'copied' | 'failed';

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function primitiveClass(value: Exclude<JsonValue, JsonValue[] | { [key: string]: JsonValue }>) {
  if (value === null) return 'null';
  return typeof value;
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

function JsonNode({ value, name, depth = 0 }: { value: JsonValue; name?: string; depth?: number }) {
  const structured = Array.isArray(value) || isObject(value);
  const [expanded, setExpanded] = useState(true);

  if (!structured) {
    return (
      <div className="json-detail-row" style={{ '--json-depth': depth } as React.CSSProperties}>
        {name !== undefined ? <span className="json-detail-key">{name}</span> : null}
        {name !== undefined ? <span className="json-detail-separator">:</span> : null}
        <PrimitiveValue value={value} />
      </div>
    );
  }

  const entries: Array<[string, JsonValue]> = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);
  const displayName = name ?? 'root';
  const summary = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`;

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
        {name !== undefined ? <span className="json-detail-key">{name}</span> : null}
        {name !== undefined ? <span className="json-detail-separator">:</span> : null}
        <span className="json-detail-summary">{summary}</span>
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
}: {
  value?: string;
  emptyText: string;
  label: string;
}) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const parsed = value === undefined ? undefined : parseJson(value);
  const isJson = parsed !== undefined;

  const copy = async () => {
    if (value === undefined) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  return (
    <div className="json-detail-view" data-json-label={label}>
      {value !== undefined ? (
        <div className="json-detail-toolbar">
          <span className="json-detail-format">{isJson ? 'JSON' : 'TEXT'}</span>
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
