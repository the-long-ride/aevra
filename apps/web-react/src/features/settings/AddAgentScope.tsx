import type { WorkspaceSummary } from '@aevra/admin-contracts';
import { Switch } from '../../components/Switch';
import type { AgentScope } from './agent-service';

export function ScopeFields({
  scope,
  workspaceIds,
  workspaces,
  disabled,
  onScope,
  onToggleWorkspace,
}: {
  scope: AgentScope;
  workspaceIds: string[];
  workspaces: WorkspaceSummary[];
  disabled: boolean;
  onScope(scope: AgentScope): void;
  onToggleWorkspace(id: string): void;
}) {
  const active = scope === 'workspace';
  return (
    <fieldset className="agent-modal-group" disabled={disabled}>
      <legend>Scope</legend>
      <div className="agent-scope-card" data-selected={scope === 'user'}>
        <label className="agent-scope-option">
          <input
            type="radio"
            name="agent-scope"
            checked={scope === 'user'}
            onChange={() => onScope('user')}
          />
          <span>Global (all my projects)</span>
        </label>
      </div>
      <div className="agent-scope-card" data-selected={active}>
        <label className="agent-scope-option">
          <input
            type="radio"
            name="agent-scope"
            checked={active}
            onChange={() => onScope('workspace')}
          />
          <span>Only these workspaces</span>
        </label>
        <div
          className="agent-workspace-list"
          role="group"
          aria-label="Workspaces"
          data-active={active}
        >
          {workspaces.length === 0 ? (
            <p className="agent-modal-hint">No workspaces registered yet.</p>
          ) : (
            workspaces.map((workspace) => (
              <Switch
                key={workspace.id}
                label={workspace.hostRoot ? workspace.name : `${workspace.name} (no folder path)`}
                checked={workspaceIds.includes(workspace.id)}
                disabled={disabled || !active || !workspace.hostRoot}
                onChange={() => onToggleWorkspace(workspace.id)}
              />
            ))
          )}
        </div>
      </div>
    </fieldset>
  );
}
