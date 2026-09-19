import type { RemoteSessionSummary, WorkspaceSummary } from '@aevra/admin-contracts';
import { useState } from 'react';
import { Dropdown } from '../../components/Dropdown';
import { DataTable } from '../../components/DataTable';
import { useDialog } from '../../components/Dialog';
import { ManagementModal } from '../../components/ManagementModal';
import { PageState } from '../../components/PageState';
import { SearchableMultiSelect, type SearchOption } from '../../components/SearchableMultiSelect';
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

interface PermissionsPageData {
  rules: PermissionRule[];
  workspaces: WorkspaceSummary[];
  sessions: RemoteSessionSummary[];
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
  'browser.control',
  'desktop.control',
  'mcp.proxy',
] as const;

async function load(signal: AbortSignal): Promise<PermissionsPageData> {
  const [rules, workspaces, sessions] = await Promise.all([
    requestJson<PermissionRule[]>('/api/permissions', { signal }),
    requestJson<WorkspaceSummary[]>('/api/workspaces', { signal }).catch(() => []),
    requestJson<RemoteSessionSummary[]>('/api/sessions', { signal }).catch(() => []),
  ]);
  return { rules, workspaces, sessions };
}

export function PermissionsPage() {
  const resource = useApiResource(load);
  const dialog = useDialog();
  const [adding, setAdding] = useState(false);
  const [commandEnabled, setCommandEnabled] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<string[]>([]);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);

  const closeAddRules = () => {
    setAdding(false);
    setCommandEnabled(false);
    setSubmitError(null);
    setSelectedWorkspaceIds([]);
    setSelectedSessionIds([]);
  };

  const revoke = async (id: string) => {
    const confirmed = await dialog.confirm({
      title: 'Revoke permission rule',
      message: 'Revoke this permission rule? This cannot be undone.',
      confirmLabel: 'Revoke',
      confirmTone: 'danger',
    });
    if (!confirmed) return;
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

  const workspaceOptions: SearchOption[] = (resource.data?.workspaces ?? []).map((w) => ({
    value: w.id,
    label: w.name || w.id,
    description:
      w.name !== w.id
        ? `ID: ${w.id}${w.hostRoot ? ` · ${w.hostRoot}` : ''}`
        : (w.hostRoot ?? `ID: ${w.id}`),
  }));

  const sessionOptions: SearchOption[] = (resource.data?.sessions ?? []).map((s) => {
    const wsName = s.lease?.workspaceId
      ? resource.data?.workspaces?.find((w) => w.id === s.lease?.workspaceId)?.name
      : undefined;
    const wsInfo = wsName
      ? `Workspace: ${wsName}`
      : s.lease?.workspaceId
        ? `Workspace: ${s.lease.workspaceId}`
        : '';
    return {
      value: s.id,
      label: s.actor ? `${s.actor} (${s.id})` : s.id,
      description: wsInfo ? `${wsInfo} · ID: ${s.id}` : `ID: ${s.id}`,
    };
  });

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
            <div className="field">
              <label htmlFor="workspace-ids-input">Workspace IDs</label>
              <SearchableMultiSelect
                id="workspace-ids-input"
                name="workspaceIds"
                placeholder="Search workspace by name or enter ID…"
                options={workspaceOptions}
                values={selectedWorkspaceIds}
                onChange={setSelectedWorkspaceIds}
              />
            </div>
            <div className="field">
              <label htmlFor="session-ids-input">Session IDs</label>
              <SearchableMultiSelect
                id="session-ids-input"
                name="sessionIds"
                placeholder="Search session by actor, name, or enter ID…"
                options={sessionOptions}
                values={selectedSessionIds}
                onChange={setSelectedSessionIds}
              />
            </div>
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
          rows={resource.data?.rules ?? []}
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
                  className="danger-button"
                  aria-label="Revoke"
                  title="Revoke"
                  data-surface-id="permissions:revoke"
                  onClick={() => void revoke(row.id)}
                >
                  [x]
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
