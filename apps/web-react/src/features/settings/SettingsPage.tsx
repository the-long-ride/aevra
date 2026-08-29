import { useCallback, useEffect, useState } from 'react';
import { PageState } from '../../components/PageState';
import { CommandPolicySettings } from './CommandPolicySettings';
import { EnvironmentProfilesSettings } from './EnvironmentProfilesSettings';
import { ExecutionSettings } from './ExecutionSettings';
import { HooksSettings } from './HooksSettings';
import { KeepAwakeSettings } from './KeepAwakeSettings';
import { NetworkPolicySettings } from './NetworkPolicySettings';
import { RemoteAccessSettings } from './RemoteAccessSettings';
import { SecretReferencesSettings } from './SecretReferencesSettings';
import { YoloPolicySettings } from './YoloPolicySettings';
import { loadSettings, patchJson, type SettingsData } from './settings-service';

export function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const refresh = useCallback(async () => {
    try {
      setData(await loadSettings());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!data) {
    return (
      <PageState loading={!error} error={error}>
        Settings
      </PageState>
    );
  }

  return (
    <>
      <section className="page-head settings-page-head">
        <div>
          <h2>Settings</h2>
          <p>Execution, remote access, network, environment, and secure local configuration.</p>
        </div>
      </section>
      <RemoteAccessSettings status={data.exposure} onChanged={refresh} />
      <div className="settings-grid settings-grid-compact">
        <KeepAwakeSettings
          status={data.power}
          onSave={(mode) => patchJson('/api/power/keep-awake', { mode }).then(refresh)}
        />
        <ExecutionSettings execution={data.execution} onChanged={refresh} />
        <YoloPolicySettings mode={data.yolo.mode} onChanged={refresh} />
        <section className="panel settings-compact-panel configuration-panel">
          <div className="panel-head compact-panel-head">
            <div>
              <h3>Configuration</h3>
              <p>Export the current local or portable configuration.</p>
            </div>
          </div>
          <div className="actions compact-settings-actions">
            <a href="/api/config/export" target="_blank" rel="noreferrer">
              <button type="button">Export local</button>
            </a>
            <a href="/api/config/export?portable=1" target="_blank" rel="noreferrer">
              <button type="button">Export portable</button>
            </a>
          </div>
          <details className="configuration-details">
            <summary>View raw configuration</summary>
            <pre>{JSON.stringify(data.adminSettings, null, 2)}</pre>
          </details>
        </section>
        <CommandPolicySettings families={data.commandFamilies} onChanged={refresh} />
        <NetworkPolicySettings
          rules={data.networkRules}
          workspaces={data.workspaces}
          onChanged={refresh}
        />
        <EnvironmentProfilesSettings profiles={data.profiles} onChanged={refresh} />
        <SecretReferencesSettings secretRefs={data.secretRefs} onChanged={refresh} />
        <HooksSettings hooks={data.hooks} onChanged={refresh} />
      </div>
    </>
  );
}
