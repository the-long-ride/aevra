import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, type Column, type FilterDefinition } from '../../components/DataTable';
import { useDialog } from '../../components/Dialog';
import { requestJson } from '../../services/api-client';
import { DetailIcon } from '../workspaces/WorkspaceIcons';
import {
  McpUpstreamEditModal,
  type UpstreamDraft,
  type UpstreamRiskTier,
  type UpstreamTransport,
} from './McpUpstreamEditModal';

export type UpstreamState = 'active' | 'degraded' | 'needs-review';
export interface UpstreamSummary {
  id: string;
  name: string;
  transport: UpstreamTransport;
  config: { command?: string; args?: string[]; cwd?: string; url?: string };
  auth: { kind: string; header?: string; secretRefId?: string; env?: Record<string, string> };
  risk: UpstreamRiskTier;
  enabled: boolean;
  state: UpstreamState;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  pendingCatalogDiff: { added: string[]; removed: string[]; changed: string[] } | null;
  advisory: Array<{ tool: string; readOnlyHint?: boolean; destructiveHint?: boolean }>;
  createdAt: string;
  updatedAt: string;
}
export interface UpstreamTestResult {
  ok: boolean;
  serverName: string | null;
  serverVersion: string | null;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  state: UpstreamState;
  message: string | null;
}
const BASE = '/api/mcp/upstreams';
const item = (id: string) => `${BASE}/${encodeURIComponent(id)}`;
const loadUpstreams = () =>
  requestJson<{ upstreams: UpstreamSummary[] }>(BASE).then((value) => value.upstreams);
const createUpstream = (draft: UpstreamDraft) =>
  requestJson<UpstreamSummary>(BASE, { method: 'POST', body: JSON.stringify(draft) });
const updateUpstream = (id: string, draft: UpstreamDraft) =>
  requestJson<UpstreamSummary>(item(id), { method: 'POST', body: JSON.stringify(draft) });
const removeUpstream = (id: string) =>
  requestJson<{ ok: boolean }>(item(id), { method: 'DELETE' });
const testUpstream = (id: string) =>
  requestJson<UpstreamTestResult>(`${item(id)}/test`, { method: 'POST' });
const acknowledgeUpstream = (id: string) =>
  requestJson<UpstreamSummary>(`${item(id)}/acknowledge`, { method: 'POST' });
const labels: Record<UpstreamState, string> = {
  active: 'Active',
  degraded: 'Degraded',
  'needs-review': 'Needs review',
};

function McpTestIcon() {
  return (
    <svg
      viewBox="0 -0.5 17 17"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="workspace-action-icon"
    >
      <path
        d="M12,1 L12,0.023 L6,0.023 C6,0.023 6,0.013 6,1 L7.012,1 L7.012,7 L3,15 C3,15 3,15.962 4,15.962 L14,15.962 C15,15.962 15,15 15,15 L10.958,7 L10.938,1 L12,1 L12,1 Z M14,15.031 L4,15.031 L8,7 L8,1 L10,1 L10,7 L14,15.031 L14,15.031 Z"
        fill="currentColor"
        className="si-glyph-fill"
      />
    </svg>
  );
}

export function McpUpstreamsSettings({
  load = loadUpstreams,
  create = createUpstream,
  update = updateUpstream,
  remove = removeUpstream,
  test = testUpstream,
  acknowledge = acknowledgeUpstream,
}: {
  load?: () => Promise<UpstreamSummary[]>;
  create?: (draft: UpstreamDraft) => Promise<UpstreamSummary>;
  update?: (id: string, draft: UpstreamDraft) => Promise<UpstreamSummary>;
  remove?: (id: string) => Promise<{ ok: boolean }>;
  test?: (id: string) => Promise<UpstreamTestResult>;
  acknowledge?: (id: string) => Promise<UpstreamSummary>;
}) {
  const [upstreams, setUpstreams] = useState<UpstreamSummary[] | null>(null),
    [adding, setAdding] = useState(false),
    [editing, setEditing] = useState<UpstreamSummary | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [formError, setFormError] = useState(''),
    [results, setResults] = useState<Record<string, string>>({});
  const dialog = useDialog();
  const refresh = useCallback(async () => {
    try {
      setUpstreams(await load());
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [load]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const run = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const handleRemove = async (upstream: UpstreamSummary) => {
    const confirmed = await dialog.confirm({
      title: 'Remove MCP server',
      message: `Remove "${upstream.name}"? This cannot be undone.`,
      confirmLabel: 'Remove',
      confirmTone: 'danger',
    });
    if (!confirmed) return;
    void run(() => remove(upstream.id));
  };
  const submit = async (draft: UpstreamDraft) => {
    if (busy) return;
    setBusy(true);
    setFormError('');
    try {
      if (editing) await update(editing.id, draft);
      else await create(draft);
      setAdding(false);
      setEditing(null);
      await refresh();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<UpstreamSummary>[] = useMemo(
    () => [
      {
        key: 'name',
        label: 'Server',
        value: (row) => row.name,
        render: (row) => (
          <div>
            <strong>{row.name}</strong>
            {results[row.id] ? <p className="inline-result">{results[row.id]}</p> : null}
            {row.state === 'needs-review' && row.pendingCatalogDiff ? (
              <div className="inline-result warning-text">
                <p>
                  This server changed its catalog. Its tools are not served until you accept the
                  change.
                </p>
                <ul>
                  {row.pendingCatalogDiff.added.map((name) => (
                    <li key={`a-${name}`}>Added: {name}</li>
                  ))}
                  {row.pendingCatalogDiff.removed.map((name) => (
                    <li key={`r-${name}`}>Removed: {name}</li>
                  ))}
                  {row.pendingCatalogDiff.changed.map((name) => (
                    <li key={`c-${name}`}>Changed: {name}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => acknowledge(row.id))}
                >
                  Acknowledge {row.name}
                </button>
              </div>
            ) : null}
            {row.advisory.length ? (
              <details>
                <summary>Hints this server claims about itself (advisory only)</summary>
                <p className="section-note">Shown for context; it does not affect the risk tier.</p>
                <ul>
                  {row.advisory.map((hint) => (
                    <li key={hint.tool}>
                      {hint.tool}: {hint.readOnlyHint ? 'claims read-only' : 'no read-only claim'}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ),
      },
      {
        key: 'state',
        label: 'Status',
        value: (row) => labels[row.state] ?? row.state,
        render: (row) => <span className="status warning">{labels[row.state] ?? row.state}</span>,
      },
      {
        key: 'risk',
        label: 'Risk',
        value: (row) => row.risk,
        render: (row) => <span className="risk">{row.risk}</span>,
      },
      {
        key: 'toolCount',
        label: 'Tools',
        value: (row) => row.toolCount,
        render: (row) => <span className="section-note">{row.toolCount} tools</span>,
      },
      {
        key: 'transport',
        label: 'Transport',
        value: (row) =>
          `${row.transport} ${row.config.url ?? [row.config.command, ...(row.config.args ?? [])].filter(Boolean).join(' ')}`,
        render: (row) => (
          <span className="section-note">
            {row.transport} ·{' '}
            <code>
              {row.config.url ??
                [row.config.command, ...(row.config.args ?? [])].filter(Boolean).join(' ')}
            </code>
          </span>
        ),
      },
      {
        key: 'actions',
        label: '',
        sortable: false,
        search: false,
        render: (row) => (
          <div className="actions workspace-row-actions compact-settings-actions">
            <button
              type="button"
              disabled={busy}
              aria-label={`Test ${row.name}`}
              title={`Test ${row.name}`}
              onClick={() =>
                void run(async () => {
                  const result = await test(row.id);
                  setResults((previous) => ({
                    ...previous,
                    [row.id]: result.ok
                      ? `${result.serverName ?? 'unknown'} ${result.serverVersion ?? ''} — ${result.toolCount} tools`
                      : (result.message ?? 'The connection failed'),
                  }));
                })
              }
            >
              <McpTestIcon />
            </button>
            <button
              type="button"
              disabled={busy}
              aria-label={`Edit ${row.name}`}
              title={`Edit ${row.name}`}
              onClick={() => {
                setAdding(false);
                setEditing(row);
              }}
            >
              <DetailIcon />
            </button>
            <button
              type="button"
              className="danger-button"
              disabled={busy}
              aria-label={`Remove ${row.name}`}
              onClick={() => void handleRemove(row)}
            >
              [x]
            </button>
          </div>
        ),
      },
    ],
    [busy, results],
  );

  const filters: FilterDefinition<UpstreamSummary>[] = useMemo(
    () => [
      {
        key: 'state',
        label: 'Status',
        value: (row) => labels[row.state] ?? row.state,
      },
      {
        key: 'transport',
        label: 'Transport',
        value: (row) => row.transport,
      },
      {
        key: 'risk',
        label: 'Risk',
        value: (row) => row.risk,
      },
    ],
    [],
  );

  return (
    <section
      className="panel settings-compact-panel wide"
      role="region"
      aria-label="MCP upstream servers"
    >
      <div className="panel-head compact-panel-head">
        <div>
          <h3>MCP servers</h3>
          <p>Other MCP servers Aevra connects to and republishes to the AI.</p>
        </div>
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => {
            setEditing(null);
            setAdding(true);
          }}
        >
          Add server
        </button>
      </div>
      <DataTable
        id="react-mcp-upstreams"
        rows={upstreams ?? []}
        columns={columns}
        filters={filters}
        pageSize={10}
        defaultSort={{ key: 'name', direction: 'asc' }}
        searchPlaceholder="Search servers…"
        emptyText="No MCP servers are registered yet."
        rowKey={(row) => row.id}
        rowProps={(row) => ({
          'aria-label': row.name,
        })}
      />
      {error ? (
        <p role="alert" className="inline-result warning-text">
          {error}
        </p>
      ) : null}
      {adding || editing ? (
        <McpUpstreamEditModal
          initial={editing ?? undefined}
          submitting={busy}
          error={formError}
          onClose={() => {
            setAdding(false);
            setEditing(null);
            setFormError('');
          }}
          onSubmit={(draft) => void submit(draft)}
        />
      ) : null}
    </section>
  );
}
