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
      {detected.map((agent) => {
        const { target } = agent;
        const done = installed.includes(target);
        const usable = agent.found || forced.includes(target);
        const hint = done ? 'Installed' : agent.found ? `Found: ${agent.configPath}` : 'Not found';
        return (
          <div
            className="agent-modal-row agent-agent-card"
            role="group"
            aria-label={target}
            key={target}
          >
            <div className="agent-agent-text">
              <Switch
                label={<strong>{target}</strong>}
                checked={selected.includes(target)}
                disabled={disabled || !usable || done}
                aria-describedby={`agent-hint-${target}`}
                onChange={() => onToggle(target)}
              />
              <span id={`agent-hint-${target}`} className="agent-modal-hint">
                {hint}
              </span>
            </div>
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
        );
      })}
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
      <label htmlFor="agent-modal-transport">Transport</label>
      <select
        id="agent-modal-transport"
        value={transport}
        aria-describedby={workspace ? 'agent-transport-reason' : undefined}
        onChange={(event) => onTransport(event.target.value as AgentTransport)}
      >
        <option value="stdio">stdio (recommended)</option>
        <option value="http" disabled={workspace}>
          HTTP
        </option>
      </select>
      {workspace && (
        <>
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
        </>
      )}
    </fieldset>
  );
}
