import type { ConnectorProfilesResponse, ResultFormat, ToolGroup } from '@aevra/admin-contracts';
import { useEffect, useState } from 'react';
import { Dropdown } from '../../components/Dropdown';
import { Switch } from '../../components/Switch';
import { useToast } from '../../components/Toast';
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

function GroupLabel({ name, hint }: { name: string; hint: string }) {
  return (
    <span className="tool-surface-name">
      <span>{name}</span>
      <span className="token-usage-note">{hint}</span>
    </span>
  );
}

export function ConnectionToolSurface({ actor }: { actor: string }) {
  const [info, setInfo] = useState<ConnectorProfilesResponse>();
  const [groups, setGroups] = useState<ToolGroup[]>([]);
  const [format, setFormat] = useState<ResultFormat>('both');
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');
  const { toast, success, error } = useToast();

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
      success('Saved. Applies the next time this client lists tools.');
    } catch {
      error('Could not save the tool surface.');
    } finally {
      setState('idle');
    }
  };

  return (
    <section
      className="tool-surface connection-section"
      aria-label="Tool surface"
      data-surface-id="connections:tool-surface"
    >
      <h3 className="connection-section-title">Tool surface</h3>
      <p className="token-usage-note">
        Tools this client sees. Fewer tools means fewer tokens on every conversation.
      </p>
      <ul className="tool-surface-list">
        <li>
          <Switch
            containerClassName="tool-surface-switch"
            aria-label="core"
            checked
            disabled
            readOnly
            label={
              <GroupLabel
                name="core"
                hint={`always on · ~${formatTokens(info.groupTokens.core)} tokens`}
              />
            }
          />
        </li>
        {info.groups.map((group) => (
          <li key={group}>
            <Switch
              containerClassName="tool-surface-switch"
              aria-label={group}
              checked={groups.includes(group)}
              onChange={() => toggle(group)}
              label={
                <GroupLabel
                  name={group}
                  hint={`~${formatTokens(info.groupTokens[group])} tokens`}
                />
              }
            />
          </li>
        ))}
      </ul>
      {saving > 0 && (
        <p className="token-usage-note">
          Saves about {formatTokens(saving)} tokens per conversation (est.).
        </p>
      )}
      <div className="tool-surface-actions">
        <Dropdown
          ariaLabel="Result format"
          value={format}
          options={FORMAT_OPTIONS}
          onChange={(value) => {
            setFormat(value as ResultFormat);
          }}
        />
        <button
          type="button"
          className="primary"
          data-surface-id="connections:tool-surface-save"
          disabled={state === 'saving'}
          onClick={() => void save()}
        >
          Save tool surface
        </button>
      </div>
      {format === 'structured' && (
        <p className="token-usage-note">
          Some clients ignore structured content. Use this only if yours reads it.
        </p>
      )}
      {toast}
    </section>
  );
}
