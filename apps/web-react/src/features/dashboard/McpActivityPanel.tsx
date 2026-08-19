import type { McpActivityEntry, WorkspaceSummary } from '@aevra/admin-contracts';
import { useEffect, useMemo, useState } from 'react';

type StreamState = 'connecting' | 'live' | 'reconnecting' | 'unsupported';

function clientLabel(actor: string) {
  return actor.replace(/^(oauth:|connector:)/, '') || actor;
}

function mergeActivity(current: McpActivityEntry[], incoming: McpActivityEntry) {
  const next = new Map(current.map((entry) => [entry.id, entry]));
  next.set(incoming.id, incoming);
  return [...next.values()]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, 100);
}

function validEntry(value: unknown): value is McpActivityEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<McpActivityEntry>;
  return Boolean(
    entry.id &&
      entry.actor &&
      entry.sessionId &&
      entry.action &&
      entry.updatedAt &&
      ['tool', 'rpc', 'session'].includes(String(entry.kind)) &&
      ['running', 'success', 'error'].includes(String(entry.state)),
  );
}

export function McpActivityPanel({ workspaces }: { workspaces: WorkspaceSummary[] }) {
  const [entries, setEntries] = useState<McpActivityEntry[]>([]);
  const [streamState, setStreamState] = useState<StreamState>('connecting');
  const workspaceNames = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
    [workspaces],
  );

  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      setStreamState('unsupported');
      return undefined;
    }

    const source = new EventSource('/api/activity/stream');
    source.onopen = () => setStreamState('live');
    source.onerror = () => setStreamState('reconnecting');
    source.addEventListener('activity', (event) => {
      try {
        const parsed: unknown = JSON.parse((event as MessageEvent<string>).data);
        if (validEntry(parsed)) setEntries((current) => mergeActivity(current, parsed));
      } catch {
        // Ignore malformed stream events. The stream itself remains connected.
      }
    });
    return () => source.close();
  }, []);

  return (
    <div className="mcp-activity-panel">
      <div className="live-activity-head">
        <p>Sanitized MCP operation lifecycle. Arguments, outputs, prompts, and secrets are excluded.</p>
        <span className={`activity-stream-state ${streamState}`}>
          {streamState === 'live'
            ? 'LIVE'
            : streamState === 'unsupported'
              ? 'UNAVAILABLE'
              : streamState.toUpperCase()}
        </span>
      </div>
      <div className="table-scroll">
        <table className="simple-table live-activity-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Client</th>
              <th>Workspace</th>
              <th>Type</th>
              <th>Action</th>
              <th>Status</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {entries.length ? (
              entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.updatedAt).toLocaleTimeString()}</td>
                  <td>{clientLabel(entry.actor)}</td>
                  <td>
                    {entry.workspaceId
                      ? (workspaceNames.get(entry.workspaceId) ?? entry.workspaceId)
                      : '—'}
                  </td>
                  <td>{entry.kind}</td>
                  <td>
                    <code>{entry.action}</code>
                  </td>
                  <td>
                    <span className={`activity-state ${entry.state}`}>
                      {entry.state.toUpperCase()}
                    </span>
                  </td>
                  <td>{entry.state === 'running' ? '—' : `${entry.durationMs ?? 0} ms`}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="dt-empty">
                  No MCP activity yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
