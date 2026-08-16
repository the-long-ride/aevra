import { useState } from 'react';
import { Dropdown } from '../../components/Dropdown';
import { DataTable } from '../../components/DataTable';
import { ManagementModal } from '../../components/ManagementModal';
import { PageState } from '../../components/PageState';
import { Switch } from '../../components/Switch';
import { useApiResource } from '../../hooks/use-api-resource';
import { requestJson } from '../../services/api-client';

interface PermissionRule extends Record<string, unknown> {
  id: string;
  effect?: string;
  capability?: string;
  scope?: string;
  actor?: string;
  matcher?: string;
}

const CAPABILITIES = [
  'files.read',
  'files.search',
  'git.read',
  'skills.read',
  'instructions.read',
  'files.write',
  'files.delete',
  'commands.run',
  'git.commit',
  'git.push',
  'network',
  'skills.write',
  'instructions.write',
] as const;

async function load(signal: AbortSignal) {
  return requestJson<PermissionRule[]>('/api/permissions', { signal });
}

export function PermissionsPage() {
  const resource = useApiResource(load);
  const [adding, setAdding] = useState(false);
  const [commandEnabled, setCommandEnabled] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const closeAddRules = () => {
    setAdding(false);
    setCommandEnabled(false);
    setSubmitError(null);
  };

  const revoke = async (id: string) => {
    await requestJson(`/api/permissions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    await resource.refresh();
  };

  const createRules = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);
    const form = new FormData(event.currentTarget);
    const capabilities = form.getAll('capability').map(String);
    const matchers = String(form.get('commandMatchers') ?? '')
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    try {
      await requestJson('/api/permissions/bulk', {
        method: 'POST',
        body: JSON.stringify({
          effect: form.get('effect'),
          scope: form.get('scope'),
          actors: String(form.get('actors') ?? '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
          capabilities,
          commandMatchers: matchers,
          workspaceIds: String(form.get('workspaceIds') ?? '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
          sessionIds: String(form.get('sessionIds') ?? '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        }),
      });
      closeAddRules();
      await resource.refresh();
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <PageState loading={resource.loading} error={resource.error}>
      <section className="page-head">
        <div>
          <h2>Permissions</h2>
          <p>Create connector permission records and manage remembered rules.</p>
        </div>
        <button
          type="button"
          className="primary"
          data-surface-id="permissions:add"
          onClick={() => {
            setSubmitError(null);
            setAdding(true);
          }}
        >
          Add rules
        </button>
      </section>
      <ManagementModal open={adding} title="Add permission rules" onClose={closeAddRules}>
        <form className="permission-bulk permission-modal-form" onSubmit={createRules}>
          <section className="form-section">
            <h3>Who gets access?</h3>
            <label className="field">
              <span>Connector actors</span>
              <input name="actors" placeholder="connector:ChatGPT, oauth:Claude" required />
            </label>
          </section>
          <section className="form-section">
            <h3>Where does it apply?</h3>
            <label className="field">
              <span>Scope</span>
              <Dropdown
                name="scope"
                ariaLabel="Scope"
                defaultValue="workspace"
                options={[
                  { value: 'global', label: 'Global' },
                  { value: 'workspace', label: 'Workspace' },
                  { value: 'session', label: 'Session' },
                ]}
              />
            </label>
            <label className="field">
              <span>Workspace IDs</span>
              <input name="workspaceIds" placeholder="Comma separated" />
            </label>
            <label className="field">
              <span>Session IDs</span>
              <input name="sessionIds" placeholder="Comma separated" />
            </label>
          </section>
          <section className="form-section wide">
            <h3>What can they do?</h3>
            <div className="choice-grid capability-grid">
              {CAPABILITIES.map((capability) => (
                <Switch
                  key={capability}
                  containerClassName="choice-card"
                  name="capability"
                  value={capability}
                  label={<code>{capability}</code>}
                  defaultChecked={['files.read', 'files.search'].includes(capability)}
                  onChange={
                    capability === 'commands.run'
                      ? (event) => setCommandEnabled(event.currentTarget.checked)
                      : undefined
                  }
                />
              ))}
            </div>
          </section>
          <section className="form-section wide">
            <h3>Rule details</h3>
            <label className="field">
              <span>Effect</span>
              <Dropdown
                name="effect"
                ariaLabel="Effect"
                defaultValue="allow"
                options={[
                  { value: 'allow', label: 'Allow' },
                  { value: 'deny', label: 'Deny' },
                ]}
              />
            </label>
            {commandEnabled ? (
              <label className="field">
                <span>Command matchers</span>
                <textarea
                  name="commandMatchers"
                  rows={6}
                  placeholder={'git:status\ngit:diff\nnpm:test'}
                  required
                />
                <small>One normalized matcher per line. Avoid broad * unless intentional.</small>
              </label>
            ) : null}
          </section>
          {submitError ? (
            <p className="permission-modal-error" role="alert">
              {submitError}
            </p>
          ) : null}
          <div className="modal-inline-foot permission-modal-actions">
            <button type="button" onClick={closeAddRules}>
              Cancel
            </button>
            <button type="submit" className="primary">
              Create rules
            </button>
          </div>
        </form>
      </ManagementModal>
      <section className="panel">
        <DataTable
          id="react-permissions-admin"
          rows={resource.data ?? []}
          pageSize={25}
          searchPlaceholder="Search permissions…"
          filters={[
            { key: 'effect', label: 'Effect' },
            { key: 'capability', label: 'Capability' },
            { key: 'scope', label: 'Scope' },
            { key: 'actor', label: 'Connector / actor' },
          ]}
          columns={[
            { key: 'effect', label: 'Effect' },
            { key: 'capability', label: 'Capability' },
            { key: 'scope', label: 'Scope' },
            { key: 'actor', label: 'Connector / actor' },
            { key: 'matcher', label: 'Matcher' },
            {
              key: 'actions',
              label: '',
              sortable: false,
              search: false,
              render: (row) => (
                <button
                  type="button"
                  data-surface-id="permissions:revoke"
                  onClick={() => void revoke(row.id)}
                >
                  Revoke
                </button>
              ),
            },
          ]}
          rowKey={(row) => row.id}
        />
      </section>
    </PageState>
  );
}
