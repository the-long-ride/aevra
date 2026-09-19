import { useCallback, useEffect, useState } from 'react';
import { useDialog } from '../../components/Dialog';
import { requestJson } from '../../services/api-client';
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
export const loadUpstreams = () =>
  requestJson<{ upstreams: UpstreamSummary[] }>(BASE).then((value) => value.upstreams);
export const createUpstream = (draft: UpstreamDraft) =>
  requestJson<UpstreamSummary>(BASE, { method: 'POST', body: JSON.stringify(draft) });
export const updateUpstream = (id: string, draft: UpstreamDraft) =>
  requestJson<UpstreamSummary>(item(id), { method: 'POST', body: JSON.stringify(draft) });
export const removeUpstream = (id: string) =>
  requestJson<{ ok: boolean }>(item(id), { method: 'DELETE' });
export const testUpstream = (id: string) =>
  requestJson<UpstreamTestResult>(`${item(id)}/test`, { method: 'POST' });
export const acknowledgeUpstream = (id: string) =>
  requestJson<UpstreamSummary>(`${item(id)}/acknowledge`, { method: 'POST' });
const labels: Record<UpstreamState, string> = {
  active: 'Active',
  degraded: 'Degraded',
  'needs-review': 'Needs review',
};

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
      {upstreams && upstreams.length === 0 ? (
        <p className="section-note">No MCP servers are registered yet.</p>
      ) : null}
      <ul className="stack-list">
        {(upstreams ?? []).map((upstream) => (
          <li key={upstream.id} role="listitem" aria-label={upstream.name}>
            <div className="row-head">
              <strong>{upstream.name}</strong>
              <span className="status warning">{labels[upstream.state]}</span>
              <span className="risk">{upstream.risk}</span>
              <span className="section-note">{upstream.toolCount} tools</span>
            </div>
            <p className="section-note">
              {upstream.transport} ·{' '}
              <code>
                {upstream.config.url ??
                  [upstream.config.command, ...(upstream.config.args ?? [])]
                    .filter(Boolean)
                    .join(' ')}
              </code>
            </p>
            {upstream.state === 'needs-review' && upstream.pendingCatalogDiff ? (
              <div className="inline-result warning-text">
                <p>
                  This server changed its catalog. Its tools are not served until you accept the
                  change.
                </p>
                <ul>
                  {upstream.pendingCatalogDiff.added.map((name) => (
                    <li key={`a-${name}`}>Added: {name}</li>
                  ))}
                  {upstream.pendingCatalogDiff.removed.map((name) => (
                    <li key={`r-${name}`}>Removed: {name}</li>
                  ))}
                  {upstream.pendingCatalogDiff.changed.map((name) => (
                    <li key={`c-${name}`}>Changed: {name}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => acknowledge(upstream.id))}
                >
                  Acknowledge {upstream.name}
                </button>
              </div>
            ) : null}
            {upstream.advisory.length ? (
              <details>
                <summary>Hints this server claims about itself (advisory only)</summary>
                <p className="section-note">Shown for context; it does not affect the risk tier.</p>
                <ul>
                  {upstream.advisory.map((hint) => (
                    <li key={hint.tool}>
                      {hint.tool}: {hint.readOnlyHint ? 'claims read-only' : 'no read-only claim'}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {results[upstream.id] ? <p className="inline-result">{results[upstream.id]}</p> : null}
            <div className="actions compact-settings-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await test(upstream.id);
                    setResults((previous) => ({
                      ...previous,
                      [upstream.id]: result.ok
                        ? `${result.serverName ?? 'unknown'} ${result.serverVersion ?? ''} — ${result.toolCount} tools`
                        : (result.message ?? 'The connection failed'),
                    }));
                  })
                }
              >
                Test {upstream.name}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setAdding(false);
                  setEditing(upstream);
                }}
              >
                Edit {upstream.name}
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={busy}
                aria-label={`Remove ${upstream.name}`}
                onClick={() => void handleRemove(upstream)}
              >
                [x]
              </button>
            </div>
          </li>
        ))}
      </ul>
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
