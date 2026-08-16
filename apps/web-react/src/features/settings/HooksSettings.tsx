import { DataTable } from '../../components/DataTable';
import { Dropdown } from '../../components/Dropdown';
import { deleteResource, patchJson, postJson, type HookSetting } from './settings-service';

const EVENTS = [
  'session_start',
  'session_connect',
  'session_reconnect',
  'request_received',
  'prompt_received',
  'before_tool_call',
  'after_tool_call',
  'before_response',
  'after_response',
];

const MUTATION_PERMISSIONS = [
  ['permissionBlock', 'block', 'Block'],
  ['permissionPrompt', 'modifyPrompt', 'Modify prompt'],
  ['permissionToolInput', 'modifyToolInput', 'Modify tool input'],
  ['permissionToolOutput', 'modifyToolOutput', 'Modify tool output'],
  ['permissionResponse', 'modifyResponse', 'Modify response'],
] as const;

export function HooksSettings({
  hooks,
  onChanged,
}: {
  hooks: HookSetting[];
  onChanged: () => Promise<void>;
}) {
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // React nulls `event.currentTarget` once the handler yields, so capture the
    // form element up front and reset it after the mutation succeeds.
    const form = event.currentTarget;
    const value = Object.fromEntries(new FormData(form));
    let args: string[] = [];
    let env: Record<string, string> = {};
    try {
      args = JSON.parse(String(value.args || '[]'));
      env = JSON.parse(String(value.env || '{}'));
    } catch {
      throw new Error('Hook arguments/environment must be valid JSON');
    }
    const permissions = ['observe'];
    for (const [field, permission] of MUTATION_PERMISSIONS) {
      if (value[field] === 'on') permissions.push(permission);
    }
    await postJson('/api/hooks', {
      name: value.name,
      event: value.event,
      kind: value.kind,
      execution: value.execution,
      executable: value.executable,
      args,
      env,
      permissions,
      timeoutMs: Number(value.timeoutMs),
      failurePolicy: value.failurePolicy,
      enabled: value.enabled === 'on',
    });
    form.reset();
    await onChanged();
  };

  return (
    <section className="panel wide">
      <div className="panel-head">
        <div>
          <h3>Lifecycle hooks</h3>
          <p>
            Run or launch local applications on MCP lifecycle events. Mutation permissions are
            privileged and transformed tool calls are authorized again before execution.
          </p>
        </div>
      </div>
      <form className="form-row" onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input name="name" required />
        </label>
        <label className="field">
          <span>Event</span>
          <Dropdown
            name="event"
            ariaLabel="Hook event"
            defaultValue="before_tool_call"
            options={EVENTS.map((value) => ({ value, label: value }))}
          />
        </label>
        <label className="field">
          <span>Kind</span>
          <input name="kind" defaultValue="command" required />
        </label>
        <label className="field">
          <span>Executable / app</span>
          <input name="executable" required />
        </label>
        <label className="field">
          <span>Arguments JSON</span>
          <input name="args" defaultValue="[]" />
        </label>
        <label className="field">
          <span>Environment JSON</span>
          <input name="env" defaultValue="{}" />
        </label>
        <label className="field">
          <span>Execution</span>
          <Dropdown
            name="execution"
            ariaLabel="Hook execution"
            defaultValue="run"
            options={[
              { value: 'run', label: 'Run and wait' },
              { value: 'launch', label: 'Launch app' },
            ]}
          />
        </label>
        <label className="field">
          <span>Failure policy</span>
          <Dropdown
            name="failurePolicy"
            ariaLabel="Hook failure policy"
            defaultValue="continue"
            options={[
              { value: 'continue', label: 'Continue' },
              { value: 'block', label: 'Block pre-event' },
            ]}
          />
        </label>
        <div className="field">
          <span>Permissions</span>
          <div className="actions">
            {MUTATION_PERMISSIONS.map(([field, , label]) => (
              <label key={field}>
                <input type="checkbox" name={field} /> {label}
              </label>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Timeout (ms)</span>
          <input type="number" name="timeoutMs" min={100} max={60000} defaultValue={5000} />
        </label>
        <label className="field">
          <span>Enabled</span>
          <input type="checkbox" name="enabled" defaultChecked />
        </label>
        <button className="primary" data-surface-id="settings:add-hook">
          Add hook
        </button>
      </form>
      <DataTable
        id="react-hooks"
        rows={hooks}
        columns={[
          { key: 'name', label: 'Name' },
          { key: 'event', label: 'Event' },
          { key: 'kind', label: 'Kind' },
          { key: 'executable', label: 'Executable' },
          { key: 'execution', label: 'Execution' },
          {
            key: 'permissions',
            label: 'Permissions',
            value: (row) =>
              row.permissions?.length ? row.permissions.join(', ') : 'observe, block',
          },
          { key: 'failurePolicy', label: 'Failure' },
          { key: 'enabled', label: 'Enabled', value: (row) => (row.enabled ? 'Yes' : 'No') },
          {
            key: 'actions',
            label: '',
            sortable: false,
            search: false,
            render: (row) => (
              <div className="actions">
                <button
                  type="button"
                  onClick={() =>
                    void patchJson(`/api/hooks/${encodeURIComponent(row.id)}`, {
                      enabled: !row.enabled,
                    }).then(onChanged)
                  }
                >
                  {row.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void deleteResource(`/api/hooks/${encodeURIComponent(row.id)}`).then(onChanged)
                  }
                >
                  Delete
                </button>
              </div>
            ),
          },
        ]}
        rowKey={(row) => row.id}
      />
    </section>
  );
}
