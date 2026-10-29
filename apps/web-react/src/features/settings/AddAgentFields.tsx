import { SwapControl } from '../../components/SwapControl';
import { Switch } from '../../components/Switch';
import type { AgentScope, AgentTransport, DetectedAgent } from './agent-service';

export function AgentChecklist({
  detected,
  selected,
  forced,
  installed,
  disabled,
  onToggle,
  onForce,
}: {
  detected: DetectedAgent[];
  selected: string[];
  forced: string[];
  installed: string[];
  disabled: boolean;
  onToggle(target: string): void;
  onForce(target: string): void;
}) {
  return (
    <fieldset className="agent-modal-group" disabled={disabled}>
      <legend>Agents</legend>
      <div className="agent-checklist-items">
        {detected.map((agent) => {
          const { target } = agent;
          const done = installed.includes(target);
          const usable = agent.found || forced.includes(target);
          const hint = done ? 'Installed' : agent.found ? `Found: ${agent.configPath}` : 'Not found';
          return (
            <div
              className="agent-agent-card"
              role="group"
              aria-label={target}
              key={target}
            >
              <div className="agent-agent-name">
                <Switch
                  label={<strong>{target}</strong>}
                  checked={selected.includes(target)}
                  disabled={disabled || !usable || done}
                  aria-describedby={`agent-hint-${target}`}
                  onChange={() => onToggle(target)}
                />
              </div>
              <div className="agent-agent-meta">
                <span
                  id={`agent-hint-${target}`}
                  className={`agent-modal-hint${agent.found ? ' agent-agent-path' : ''}${done ? ' agent-agent-installed' : ''}`}
                  title={agent.found ? agent.configPath : undefined}
                >
                  {hint}
                </span>
                {!agent.found && !done && (
                  <Switch
                    containerClassName="agent-modal-anyway"
                    label="Install anyway"
                    aria-label={`Install ${target} anyway`}
                    checked={forced.includes(target)}
                    disabled={disabled}
                    onChange={() => onForce(target)}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

export function TransportField({
  scope,
  transport,
  codexSelected,
  disabled,
  onTransport,
}: {
  scope: AgentScope;
  transport: AgentTransport;
  codexSelected: boolean;
  disabled: boolean;
  onTransport(transport: AgentTransport): void;
}) {
  const workspace = scope === 'workspace';
  return (
    <fieldset className="agent-modal-group" disabled={disabled}>
      <legend>Connection</legend>
      <SwapControl
        name="agent-transport"
        ariaLabel="Transport"
        value={transport}
        disabled={disabled}
        onChange={onTransport}
        options={[
          { value: 'stdio', label: 'stdio (recommended)' },
          {
            value: 'http',
            label: 'HTTP',
            disabled: workspace,
            hint: workspace ? 'Workspace connections use stdio only' : undefined,
          },
        ]}
      />
      {workspace && (
        <div className="agent-transport-notes">
          <p id="agent-transport-reason" className="agent-modal-hint">
            HTTP embeds a bearer token, so workspace connections use stdio only.
          </p>
          <p className="agent-modal-hint">
            No skill is installed for a single workspace: the shared skill folder applies to all
            projects.
          </p>
          {codexSelected && (
            <p className="agent-modal-hint">
              Codex only loads project configuration for trusted projects; trust this folder in
              Codex.
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}
