import type { ConnectorProfilesResponse, ResultFormat, ToolGroup } from '@aevra/admin-contracts';
import { useEffect, useState } from 'react';
import { Dropdown } from '../../components/Dropdown';
import {
  fetchConnectorProfiles,
  saveConnectorProfile,
} from '../../services/connector-profile-service';
import { formatTokens } from './token-format';

const FORMAT_OPTIONS: ReadonlyArray<{ value: ResultFormat; label: string }> = [
  { value: 'both', label: 'Text + structured (default)' },
  { value: 'text', label: 'Text only (smallest)' },
  { value: 'structured', label: 'Structured only' },
];

export function ConnectionToolSurface({ actor }: { actor: string }) {
  const [info, setInfo] = useState<ConnectorProfilesResponse>();
  const [groups, setGroups] = useState<ToolGroup[]>([]);
  const [format, setFormat] = useState<ResultFormat>('both');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    let live = true;
    fetchConnectorProfiles()
      .then((loaded) => {
        if (!live) return;
        const entry = loaded.entries.find((item) => item.actor === actor);
        setInfo(loaded);
        setGroups(entry?.profile.toolGroups ?? loaded.groups);
        setFormat(entry?.profile.resultFormat ?? 'both');
      })
      .catch(() => {
        if (live) setState('error');
      });
    return () => {
      live = false;
    };
  }, [actor]);

  if (!info) {
    return (
      <p className="token-usage-note">
        {state === 'error' ? 'Tool surface unavailable.' : 'Loading tool surface…'}
      </p>
    );
  }

  const saving = info.groups
    .filter((group) => !groups.includes(group))
    .reduce((sum, group) => sum + info.groupTokens[group], 0);
  const toggle = (group: ToolGroup) => {
    setState('idle');
    setGroups((current) =>
      current.includes(group) ? current.filter((item) => item !== group) : [...current, group],
    );
  };
  const save = async () => {
    setState('saving');
    try {
      await saveConnectorProfile(actor, {
        toolGroups: info.groups.filter((group) => groups.includes(group)),
        resultFormat: format,
      });
      setState('saved');
    } catch {
      setState('error');
    }
  };

  return (
    <section
      className="tool-surface"
      aria-label="Tool surface"
      data-surface-id="connections:tool-surface"
    >
      <h4 className="token-usage-heading">Tool surface</h4>
      <p className="token-usage-note">
        Tools this client sees. Fewer tools means fewer tokens on every conversation.
      </p>
      <ul className="tool-surface-list">
        <li>
          <label>
            <input type="checkbox" checked disabled aria-label="core" /> core{' '}
            <span className="token-usage-note">
              always on · ~{formatTokens(info.groupTokens.core)} tokens
            </span>
          </label>
        </li>
        {info.groups.map((group) => (
          <li key={group}>
            <label>
              <input
                type="checkbox"
                aria-label={group}
                checked={groups.includes(group)}
                onChange={() => toggle(group)}
              />{' '}
              {group}{' '}
              <span className="token-usage-note">
                ~{formatTokens(info.groupTokens[group])} tokens
              </span>
            </label>
          </li>
        ))}
      </ul>
      {saving > 0 && (
        <p className="token-usage-note">
          Saves about {formatTokens(saving)} tokens per conversation (est.).
        </p>
      )}
      <Dropdown
        ariaLabel="Result format"
        value={format}
        options={FORMAT_OPTIONS}
        onChange={(value) => {
          setFormat(value as ResultFormat);
          setState('idle');
        }}
      />
      {format === 'structured' && (
        <p className="token-usage-note">
          Some clients ignore structured content. Use this only if yours reads it.
        </p>
      )}
      <button
        type="button"
        data-surface-id="connections:tool-surface-save"
        disabled={state === 'saving'}
        onClick={() => void save()}
      >
        Save tool surface
      </button>
      {state === 'saved' && (
        <p className="token-usage-note">Saved. Applies the next time this client lists tools.</p>
      )}
      {state === 'error' && <p role="alert">Could not save the tool surface.</p>}
    </section>
  );
}
