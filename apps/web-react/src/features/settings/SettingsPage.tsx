import { useCallback, useEffect, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { PageState } from '../../components/PageState';
import { RemoteAccessPanel } from '../dashboard/RemoteAccessPanel';
import {
  deleteResource,
  loadSettings,
  patchJson,
  postJson,
  type SettingsData,
} from './settings-service';

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

  if (!data) return <PageState loading={!error} error={error}>Settings</PageState>;

  const submitExecution = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Object.fromEntries(new FormData(event.currentTarget));
    await patchJson('/api/execution-settings', {
      ...value,
      workspaceDrainMs: Number(value.workspaceDrainMs),
    });
    await refresh();
  };

  const submitCommandFamily = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Object.fromEntries(new FormData(event.currentTarget));
    await patchJson('/api/policy/command-families', {
      ...data.commandFamilies,
      [String(value.family)]: value.effect,
    });
    await refresh();
  };

  const submitNetwork = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Object.fromEntries(new FormData(event.currentTarget));
    await postJson('/api/policy/network-rules', {
      ...value,
      port: Number(value.port),
      workspaceId: value.workspaceId || undefined,
    });
    await refresh();
  };

  const submitProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Object.fromEntries(new FormData(event.currentTarget));
    await postJson('/api/environment-profiles', {
      name: value.name,
      vars: JSON.parse(String(value.vars || '{}')),
      secretRefs: JSON.parse(String(value.secretRefs || '{}')),
    });
    await refresh();
  };

  const submitSecret = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await postJson(
      '/api/secret-references',
      Object.fromEntries(new FormData(event.currentTarget)),
    );
    await refresh();
  };

  const submitAccess = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!data.cloudflare.hostname) return;
    const value = Object.fromEntries(new FormData(event.currentTarget));
    await postJson('/api/cloudflare/setup', {
      ...value,
      hostname: data.cloudflare.hostname,
      tunnelId: data.cloudflare.tunnelId,
      ownership: data.cloudflare.ownership,
    });
    await refresh();
  };

  return (
    <>
      <section className="page-head">
        <div>
          <h2>Settings</h2>
          <p>Execution, remote access, network, environment, and secure local configuration.</p>
        </div>
      </section>
      <section className="panel remote-card">
        <div className="panel-head"><h3>Remote Access</h3></div>
        <RemoteAccessPanel status={data.cloudflare} onChanged={refresh} />
        <details className="advanced-access">
          <summary>Cloudflare Access verifier</summary>
          <form className="form-row" onSubmit={submitAccess}>
            <label className="field"><span>Mode</span><select name="authMode" defaultValue={data.cloudflare.authMode ?? 'connector'}><option value="connector">Aevra OAuth only</option><option value="access">Cloudflare Access plus Aevra</option></select></label>
            <label className="field"><span>Access issuer</span><input name="issuer" defaultValue={data.cloudflare.issuer ?? ''} /></label>
            <label className="field"><span>Audience</span><input name="audience" defaultValue={data.cloudflare.audience ?? ''} /></label>
            <button data-surface-id="settings:save-access-mode">Save Access mode</button>
          </form>
        </details>
      </section>
      <div className="settings-grid">
        <section className="panel">
          <div className="panel-head"><h3>Execution</h3></div>
          <form className="stack-form" onSubmit={submitExecution}>
            <label className="field"><span>Sandbox backend</span><select name="sandboxBackend" defaultValue={String(data.execution.sandboxBackend ?? 'auto')}><option value="auto">Auto</option><option value="docker">Docker</option><option value="podman">Podman</option></select></label>
            <label className="field"><span>Cache policy</span><select name="cachePolicy" defaultValue={String(data.execution.cachePolicy ?? 'workspace')}><option value="workspace">Workspace</option><option value="shared">Shared</option><option value="disabled">Disabled</option></select></label>
            <label className="field"><span>Drain timeout (ms)</span><input type="number" name="workspaceDrainMs" defaultValue={Number(data.execution.workspaceDrainMs ?? 60000)} /></label>
            <button className="primary" data-surface-id="settings:save-execution">Save</button>
          </form>
        </section>
        <section className="panel">
          <div className="panel-head"><h3>Configuration</h3></div>
          <div className="actions"><a href="/api/config/export" target="_blank" rel="noreferrer"><button type="button">Export local</button></a><a href="/api/config/export?portable=1" target="_blank" rel="noreferrer"><button type="button">Export portable</button></a></div>
          <pre>{JSON.stringify(data.adminSettings, null, 2)}</pre>
        </section>
        <section className="panel wide">
          <div className="panel-head"><h3>Command-family overrides</h3></div>
          <form className="form-row" onSubmit={submitCommandFamily}>
            <label className="field"><span>Family</span><input name="family" required /></label>
            <label className="field"><span>Effect</span><select name="effect"><option>READ_ONLY</option><option>BUILD_OUTPUT</option><option>SOURCE_MUTATION</option><option>REPOSITORY_STATE</option><option>UNKNOWN</option></select></label>
            <button className="primary" data-surface-id="settings:save-command-family">Set override</button>
          </form>
          <DataTable
            id="react-command-families"
            rows={Object.entries(data.commandFamilies).map(([family, effect]) => ({ family, effect }))}
            columns={[
              { key: 'family', label: 'Family' },
              { key: 'effect', label: 'Effect' },
              {
                key: 'actions',
                label: '',
                sortable: false,
                search: false,
                render: (row) => (
                  <button
                    type="button"
                    data-surface-id="settings:remove-command-family"
                    onClick={() => {
                      const next = { ...data.commandFamilies };
                      delete next[row.family];
                      void patchJson('/api/policy/command-families', next).then(refresh);
                    }}
                  >
                    Remove
                  </button>
                ),
              },
            ]}
            rowKey={(row) => row.family}
          />
        </section>
        <section className="panel wide">
          <div className="panel-head"><h3>Network rules</h3></div>
          <form className="form-row" onSubmit={submitNetwork}>
            <label className="field"><span>Effect</span><select name="effect"><option value="allow">Allow</option><option value="deny">Deny</option></select></label>
            <label className="field"><span>Protocol</span><input name="protocol" defaultValue="https" required /></label>
            <label className="field"><span>Host</span><input name="host" required /></label>
            <label className="field"><span>Port</span><input type="number" name="port" defaultValue={443} required /></label>
            <label className="field"><span>Workspace</span><select name="workspaceId"><option value="">Global</option>{data.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
            <button className="primary" data-surface-id="settings:add-network-rule">Add rule</button>
          </form>
          <DataTable
            id="react-network-rules"
            rows={data.networkRules}
            columns={[
              { key: 'effect', label: 'Effect' },
              { key: 'protocol', label: 'Protocol' },
              { key: 'host', label: 'Host' },
              { key: 'port', label: 'Port' },
              { key: 'workspaceId', label: 'Workspace' },
              {
                key: 'actions',
                label: '',
                sortable: false,
                search: false,
                render: (row) => <button type="button" data-surface-id="settings:remove-network-rule" onClick={() => void deleteResource(`/api/policy/network-rules/${String(row.id)}`).then(refresh)}>Remove</button>,
              },
            ]}
          />
        </section>
        <section className="panel wide">
          <div className="panel-head"><h3>Environment profiles</h3></div>
          <form className="form-row" onSubmit={submitProfile}>
            <label className="field"><span>Name</span><input name="name" required /></label>
            <label className="field"><span>Variables JSON</span><textarea name="vars" defaultValue="{}" /></label>
            <label className="field"><span>Secret refs JSON</span><textarea name="secretRefs" defaultValue="{}" /></label>
            <button className="primary" data-surface-id="settings:create-environment-profile">Create profile</button>
          </form>
          <DataTable id="react-environment-profiles" rows={data.profiles} columns={[{ key: 'name', label: 'Name' }, { key: 'vars', label: 'Variables' }, { key: 'secretRefs', label: 'Secret references' }]} />
        </section>
        <section className="panel wide">
          <div className="panel-head"><h3>Secret references</h3></div>
          <form className="form-row" onSubmit={submitSecret}>
            <label className="field"><span>Reference</span><input name="ref" required /></label>
            <label className="field"><span>Secret value</span><input type="password" name="value" autoComplete="new-password" required /></label>
            <button className="primary" data-surface-id="settings:store-secret">Store securely</button>
          </form>
          <DataTable
            id="react-secret-references"
            rows={data.secretRefs.map((value) => ({ ref: typeof value === 'string' ? value : String(value.ref ?? value.key ?? '') }))}
            columns={[
              { key: 'ref', label: 'Reference' },
              { key: 'state', label: 'State', value: () => 'Configured' },
              {
                key: 'actions',
                label: '',
                sortable: false,
                search: false,
                render: (row) => <button type="button" data-surface-id="settings:remove-secret" onClick={() => void deleteResource(`/api/secret-references/${encodeURIComponent(row.ref)}`).then(refresh)}>Delete</button>,
              },
            ]}
            rowKey={(row) => row.ref}
          />
        </section>
      </div>
    </>
  );
}
