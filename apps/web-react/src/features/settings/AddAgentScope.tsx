import type { WorkspaceSummary } from '@aevra/admin-contracts';
import { SwapControl } from '../../components/SwapControl';
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
      <SwapControl
        name="agent-scope"
        ariaLabel="Scope"
        value={scope}
        disabled={disabled}
        onChange={onScope}
        options={[
          { value: 'user', label: 'Global (all my projects)' },
          { value: 'workspace', label: 'Only these workspaces' },
        ]}
      />
      {active && (
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
                disabled={disabled || !workspace.hostRoot}
                onChange={() => onToggleWorkspace(workspace.id)}
              />
            ))
          )}
        </div>
      )}
    </fieldset>
  );
}
