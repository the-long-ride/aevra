import type { WorkspaceSummary } from '@aevra/admin-contracts';
import { useEffect, useRef, useState } from 'react';
import { lastUsedLabel } from './agent-time';
import type { AgentRegistration } from './agent-service';

export function registrationKey(item: AgentRegistration) {
  return `${item.target}|${item.scope}|${item.workspaceRoot ?? ''}`;
}

function scopeLabel(item: AgentRegistration, workspaces: WorkspaceSummary[]) {
  if (item.scope === 'user') return 'Global';
  const known = workspaces.find((workspace) => workspace.id === item.workspaceId);
  return known?.name ?? item.workspaceRoot ?? 'Workspace';
}

function lastUsed(item: AgentRegistration) {
  return item.connectorMissing ? 'Credential missing' : lastUsedLabel(item.lastUsedAt);
}

export function AgentConnectionsTable({
  registrations,
  workspaces,
  pending,
  status,
  onUpdate,
  onRemove,
}: {
  registrations: AgentRegistration[];
  workspaces: WorkspaceSummary[];
  pending: { key: string; action: 'update' | 'remove' } | null;
  status: 'loading' | 'ready' | 'failed';
  onUpdate(item: AgentRegistration): void;
  onRemove(item: AgentRegistration): void;
}) {
  // Remove revokes the credential and edits the agent config, so it asks first, inline.
  const [confirming, setConfirming] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    const next = focusNext.current;
    focusNext.current = null;
    if (next) buttons.current.get(next)?.focus();
  }, [confirming]);
  const keep = (name: string) => (node: HTMLButtonElement | null) => {
    if (node) buttons.current.set(name, node);
    else buttons.current.delete(name);
  };
  const ask = (key: string | null, focus: string) => {
    focusNext.current = focus;
    setConfirming(key);
  };

  if (!registrations.length) {
    if (status === 'loading') return <p>Loading{'…'}</p>;
    return status === 'ready' ? (
      <div className="agent-empty">
        <p>No agents connected</p>
        <p className="agent-empty-hint">
          Press Connect to link Claude Code, Codex, OpenCode or Antigravity to Aevra.
        </p>
      </div>
    ) : null;
  }
  const orphaned = registrations.some((item) => item.scope === 'workspace' && !item.workspaceId);
  return (
    <>
      <div className="agent-connections-scroll">
        <table className="simple-table agent-connections-table" aria-label="Connected agents">
          <thead>
            <tr>
              <th scope="col">Agent</th>
              <th scope="col">Scope</th>
              <th scope="col">Transport</th>
              <th scope="col">Config file</th>
              <th scope="col">State</th>
              <th scope="col">Last used</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {registrations.map((item) => {
              const key = registrationKey(item);
              const scope = scopeLabel(item, workspaces);
              const locked = item.scope === 'workspace' && !item.workspaceId;
              const mine = pending?.key === key ? pending.action : null;
              const question = `Remove ${item.target} (${scope})?`;
              return (
                <tr key={key}>
                  <td>{item.target}</td>
                  <td>{scope}</td>
                  <td>{item.transport}</td>
                  <td className="agent-config-cell">{item.config}</td>
                  <td>{item.state ?? '-'}</td>
                  <td>{lastUsed(item)}</td>
                  <td>
                    {confirming === key && !pending ? (
                      <div
                        className="actions compact-settings-actions"
                        role="group"
                        aria-label={question}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') ask(null, `${key}|remove`);
                        }}
                      >
                        <span>{question}</span>
                        <button
                          type="button"
                          className="danger-button"
                          aria-label={`Confirm removing Aevra from ${item.target} (${scope})`}
                          onClick={() => {
                            setConfirming(null);
                            onRemove(item);
                          }}
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          ref={keep(`${key}|cancel`)}
                          onClick={() => ask(null, `${key}|remove`)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="actions compact-settings-actions">
                        <button
                          type="button"
                          disabled={!!pending || locked}
                          aria-label={`Update Aevra for ${item.target} (${scope})`}
                          onClick={() => onUpdate(item)}
                        >
                          {mine === 'update' ? 'Working…' : 'Update'}
                        </button>
                        <button
                          type="button"
                          ref={keep(`${key}|remove`)}
                          disabled={!!pending}
                          aria-label={`Remove Aevra from ${item.target} (${scope})`}
                          onClick={() => ask(key, `${key}|cancel`)}
                        >
                          {mine === 'remove' ? 'Removing…' : 'Remove'}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {orphaned && (
        <p className="compact-settings-note">
          This folder is not a registered Aevra workspace (or it was deleted), so its connection
          cannot be updated here. Remove still deletes it; register the folder as a workspace to
          manage it here.
        </p>
      )}
    </>
  );
}
