import type { ToolSwitchEntry } from '@aevra/admin-contracts';
import { useState } from 'react';
import { Switch } from '../../components/Switch';

const LOCKED_TITLE = 'Always on: agents need this tool';

export interface ToolGroupData {
  title: string;
  tools: ToolSwitchEntry[];
}

export function ToolSwitchGroup({
  group,
  disabled,
  onToggle,
  onToggleGroup,
  searchActive = false,
  defaultOpen = false,
}: {
  group: ToolGroupData;
  disabled: ReadonlySet<string>;
  onToggle(name: string): void;
  onToggleGroup(tools: ToolSwitchEntry[], enable: boolean): void;
  searchActive?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = searchActive || open;
  const unlocked = group.tools.filter((tool) => !tool.locked);
  const allOn = unlocked.every((tool) => !disabled.has(tool.name));
  return (
    <section className="tool-switch-group" aria-label={group.title}>
      <div className="tool-switch-group-head">
        <Switch
          containerClassName="tool-switch-group-switch"
          aria-label={`${group.title}: all tools`}
          checked={allOn}
          disabled={unlocked.length === 0}
          onChange={() => onToggleGroup(unlocked, !allOn)}
          label={<span className="tool-switch-group-title">{group.title}</span>}
        />
        <button
          type="button"
          className="tool-switch-group-collapse"
          aria-expanded={isOpen}
          aria-label={isOpen ? `Collapse ${group.title}` : `Expand ${group.title}`}
          onClick={() => setOpen((prev) => !prev)}
        >
          <span
            className={`tool-switch-collapse-icon${isOpen ? ' is-open' : ''}`}
            aria-hidden="true"
          >
            ▾
          </span>
        </button>
      </div>
      {isOpen ? (
        <ul className="tool-switch-list">
          {group.tools.map((tool) => (
            <li
              key={tool.name}
              className={`tool-switch-row${tool.available ? '' : ' is-unavailable'}`}
            >
              <Switch
                containerClassName="tool-switch-row-switch"
                aria-label={tool.name}
                title={tool.locked ? LOCKED_TITLE : tool.description || undefined}
                checked={tool.locked || !disabled.has(tool.name)}
                disabled={tool.locked}
                onChange={() => onToggle(tool.name)}
                label={<span className="tool-switch-name">{tool.name}</span>}
              />
              {tool.available ? null : <span className="tool-switch-hint">Server not active</span>}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
