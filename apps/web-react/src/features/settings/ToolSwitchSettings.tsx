import type { ToolSwitchEntry } from '@aevra/admin-contracts';
import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../components/Toast';
import { fetchToolSwitches, saveToolSwitches } from '../../services/tool-switch-service';
import { ToolSwitchGroup, type ToolGroupData } from './ToolSwitchGroup';

function buildGroups(tools: ToolSwitchEntry[]): ToolGroupData[] {
  const builtin = new Map<string, ToolSwitchEntry[]>();
  const upstream = new Map<string, ToolSwitchEntry[]>();
  for (const tool of tools) {
    const target = tool.source === 'aevra' ? builtin : upstream;
    const key = tool.source === 'aevra' ? tool.group : tool.source;
    target.set(key, [...(target.get(key) ?? []), tool]);
  }
  return [
    ...[...builtin].map(([key, list]) => ({ title: `Aevra: ${key}`, tools: list })),
    ...[...upstream].map(([key, list]) => ({ title: key, tools: list })),
  ];
}

export function ToolSwitchSettings() {
  const [tools, setTools] = useState<ToolSwitchEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const { toast, success, error } = useToast(3000);

  useEffect(() => {
    let live = true;
    fetchToolSwitches()
      .then((loaded) => {
        if (!live) return;
        setTools(loaded.tools);
        setDisabled(new Set(loaded.tools.filter((tool) => !tool.enabled).map((tool) => tool.name)));
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const query = search.trim().toLowerCase();
  const visible = useMemo(
    () => (tools ?? []).filter((tool) => tool.name.toLowerCase().includes(query)),
    [tools, query],
  );
  const groups = useMemo(() => buildGroups(visible), [visible]);

  const toggle = (name: string) =>
    setDisabled((current) => {
      const next = new Set(current);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  const toggleGroup = (list: ToolSwitchEntry[], enable: boolean) =>
    setDisabled((current) => {
      const next = new Set(current);
      for (const tool of list) {
        if (enable) next.delete(tool.name);
        else next.add(tool.name);
      }
      return next;
    });
  const save = async () => {
    setSaving(true);
    try {
      const fresh = await saveToolSwitches([...disabled].sort());
      setTools(fresh.tools);
      setDisabled(new Set(fresh.tools.filter((tool) => !tool.enabled).map((tool) => tool.name)));
      success('Tool switches saved.');
    } catch (cause) {
      error(cause);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="panel settings-compact-panel tool-switch-panel"
      role="region"
      aria-label="Tools"
    >
      <div className="panel-head compact-panel-head">
        <div>
          <h3>Tools</h3>
          <p>
            Turn individual tools off for every connected agent. Connected agents pick up changes on
            reconnect or when their tool list cache expires.
          </p>
        </div>
      </div>
      {failed ? (
        <p className="section-note">Tool switches unavailable.</p>
      ) : !tools ? (
        <p className="section-note">Loading tools...</p>
      ) : (
        <>
          <label className="tool-switch-search">
            Search tools
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search tool names"
            />
          </label>
          <p className="section-note">
            {visible.length} of {tools.length} tools
          </p>
          {visible.length === 0 ? (
            <p className="section-note">No tools match your search.</p>
          ) : null}
          <div className="tool-switch-groups">
            {groups.map((group) => (
              <ToolSwitchGroup
                key={group.title}
                group={group}
                disabled={disabled}
                onToggle={toggle}
                onToggleGroup={toggleGroup}
                searchActive={query.length > 0}
              />
            ))}
          </div>
          <div className="actions compact-settings-actions">
            <button type="button" className="primary" disabled={saving} onClick={() => void save()}>
              Save tool switches
            </button>
          </div>
        </>
      )}
      {toast}
    </section>
  );
}
