import type {
  McpUpstreamToolDocumentation,
  McpUpstreamDocumentationSource,
} from '@aevra/admin-contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DataTable, type Column, type FilterDefinition } from '../../components/DataTable';
import { useDialog } from '../../components/Dialog';
import { useToast } from '../../components/Toast';
import { requestJson } from '../../services/api-client';
import {
  McpUpstreamEditModal,
  type UpstreamDraft,
  type UpstreamRiskTier,
  type UpstreamTransport,
} from './McpUpstreamEditModal';
import {
  McpUpstreamHintsModal,
  McpUpstreamStatus,
  upstreamStatusLabel,
} from './McpUpstreamDetails';
import { McpUpstreamRowActions } from './McpUpstreamRowActions';
import { McpUpstreamReviewModal } from './McpUpstreamReviewModal';
import { McpUpstreamReviewNotice, reviewColumn } from './McpUpstreamReviewColumn';
import { CATALOG_CHANGED_MESSAGE, isCatalogChangedError } from './mcp-upstream-review';

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
  pendingCatalogFingerprint?: string | null;
  pendingCatalogDiff: { added: string[]; removed: string[]; changed: string[] } | null;
  tools?: McpUpstreamToolDocumentation[];
  documentationSource?: McpUpstreamDocumentationSource;
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
export const MCP_UPSTREAM_REFRESH_MS = 30_000;
const BASE = '/api/mcp/upstreams';
const item = (id: string) => `${BASE}/${encodeURIComponent(id)}`;
const loadUpstreams = () =>
  requestJson<{ upstreams: UpstreamSummary[] }>(BASE).then((value) => value.upstreams);
const createUpstream = (draft: UpstreamDraft) =>
  requestJson<UpstreamSummary>(BASE, { method: 'POST', body: JSON.stringify(draft) });
const updateUpstream = (id: string, draft: UpstreamDraft) =>
  requestJson<UpstreamSummary>(item(id), { method: 'POST', body: JSON.stringify(draft) });
const removeUpstream = (id: string) => requestJson<{ ok: boolean }>(item(id), { method: 'DELETE' });
const testUpstream = (id: string) =>
  requestJson<UpstreamTestResult>(`${item(id)}/test`, { method: 'POST' });
const acknowledgeUpstream = (id: string, expectedFingerprint?: string | null) =>
  requestJson<UpstreamSummary>(`${item(id)}/acknowledge`, {
    method: 'POST',
    body: JSON.stringify({ expectedFingerprint }),
  });
const toggleUpstream = (id: string, enabled: boolean) =>
  requestJson<UpstreamSummary>(`${item(id)}/${enabled ? 'enable' : 'disable'}`, {
    method: 'POST',
  });

export function McpUpstreamsSettings({
  load = loadUpstreams,
  create = createUpstream,
  update = updateUpstream,
  remove = removeUpstream,
  test = testUpstream,
  acknowledge = acknowledgeUpstream,
  setEnabled = toggleUpstream,
  refreshMs = MCP_UPSTREAM_REFRESH_MS,
}: {
  load?: () => Promise<UpstreamSummary[]>;
  create?: (draft: UpstreamDraft) => Promise<UpstreamSummary>;
  update?: (id: string, draft: UpstreamDraft) => Promise<UpstreamSummary>;
  remove?: (id: string) => Promise<{ ok: boolean }>;
  test?: (id: string) => Promise<UpstreamTestResult>;
  acknowledge?: (id: string, expectedFingerprint?: string | null) => Promise<UpstreamSummary>;
  setEnabled?: (id: string, enabled: boolean) => Promise<unknown>;
  refreshMs?: number;
}) {
  const [upstreams, setUpstreams] = useState<UpstreamSummary[] | null>(null),
    [adding, setAdding] = useState(false),
    [hints, setHints] = useState<UpstreamSummary | null>(null),
    [editing, setEditing] = useState<UpstreamSummary | null>(null),
    [reviewing, setReviewing] = useState<UpstreamSummary | null>(null),
    [busy, setBusy] = useState(false);
  const { toast, success, error } = useToast();
  const dialog = useDialog();
  const refresh = useCallback(async () => {
    try {
      setUpstreams(await load());
    } catch (cause) {
      error(cause);
    }
  }, [load, error]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const refreshGuard = useRef({ refresh, skip: false });
  refreshGuard.current = { refresh, skip: busy || adding || editing !== null };
  useEffect(() => {
    const tick = () => {
      if (!refreshGuard.current.skip) void refreshGuard.current.refresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };
    const timer = setInterval(tick, refreshMs);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', tick);
    };
  }, [refreshMs]);
  const run = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
      await refresh();
    } catch (cause) {
      if (isCatalogChangedError(cause)) {
        setReviewing(null);
        error(CATALOG_CHANGED_MESSAGE);
        await refresh();
      } else error(cause);
    } finally {
      setBusy(false);
    }
  };
  const runTest = (row: UpstreamSummary) =>
    run(async () => {
      const result = await test(row.id);
      if (result.ok) {
        success(
          `${row.name}: ${result.serverName ?? 'unknown'} ${result.serverVersion ?? ''} — ${result.toolCount} tools`,
        );
      } else {
        error(`${row.name}: ${result.message ?? 'The connection failed'}`);
      }
    });
  const handleRemove = async (upstream: UpstreamSummary) => {
    const confirmed = await dialog.confirm({
      title: 'Remove MCP server',
      message: `Remove "${upstream.name}"? This cannot be undone.`,
      confirmLabel: 'Remove',
      confirmTone: 'danger',
    });
    if (!confirmed) return;
    void run(async () => {
      await remove(upstream.id);
      success(`MCP server "${upstream.name}" removed.`);
    });
  };
  const submit = async (draft: UpstreamDraft) => {
    if (busy) return;
    setBusy(true);
    try {
      if (editing) {
        await update(editing.id, draft);
        success(`MCP server "${draft.name}" updated.`);
      } else {
        await create(draft);
        success(`MCP server "${draft.name}" added.`);
      }
      setAdding(false);
      setEditing(null);
      await refresh();
    } catch (cause) {
      error(cause);
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<UpstreamSummary>[] = useMemo(
    () => [
      reviewColumn(setReviewing),
      {
        key: 'name',
        label: 'Server',
        value: (row) => row.name,
        render: (row) => <strong>{row.name}</strong>,
      },
      {
        key: 'state',
        label: 'Status',
        value: upstreamStatusLabel,
        render: (row) => <McpUpstreamStatus row={row} />,
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
          <McpUpstreamRowActions
            row={row}
            busy={busy}
            onHints={() => setHints(row)}
            onToggle={(enabled) =>
              void run(async () => {
                await setEnabled(row.id, enabled);
                success(enabled ? `Enabled ${row.name}.` : `Disabled ${row.name}.`);
              })
            }
            onTest={() => void runTest(row)}
            onEdit={() => {
              setAdding(false);
              setEditing(row);
            }}
            onRemove={() => void handleRemove(row)}
          />
        ),
      },
    ],
    [busy, success, error, setEnabled, test, run, runTest],
  );

  const filters: FilterDefinition<UpstreamSummary>[] = useMemo(
    () => [
      {
        key: 'state',
        label: 'Status',
        value: upstreamStatusLabel,
      },
      {
        key: 'enabled',
        label: 'Enabled',
        value: (row) => (row.enabled ? 'Enabled' : 'Disabled'),
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
      <McpUpstreamReviewNotice rows={upstreams ?? []} />
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
          className: row.enabled ? undefined : 'is-disabled',
        })}
      />
      {adding || editing ? (
        <McpUpstreamEditModal
          initial={editing ?? undefined}
          submitting={busy}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSubmit={(draft) => void submit(draft)}
        />
      ) : null}
      {hints ? <McpUpstreamHintsModal row={hints} onClose={() => setHints(null)} /> : null}
      {reviewing ? (
        <McpUpstreamReviewModal
          row={reviewing}
          busy={busy}
          onClose={() => setReviewing(null)}
          onAccept={(fingerprint) =>
            void run(async () => {
              await acknowledge(reviewing.id, fingerprint);
              success(`Acknowledged changes for "${reviewing.name}".`);
              setReviewing(null);
            })
          }
          onTest={() => void runTest(reviewing).then(() => setReviewing(null))}
        />
      ) : null}
      {toast}
    </section>
  );
}
