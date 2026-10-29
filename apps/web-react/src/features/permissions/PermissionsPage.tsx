import type { CommandRuleV2 } from '@aevra/admin-contracts';
import { useState } from 'react';
import { Dropdown } from '../../components/Dropdown';
import { DataTable } from '../../components/DataTable';
import { useDialog } from '../../components/Dialog';
import { ManagementModal } from '../../components/ManagementModal';
import { PageState } from '../../components/PageState';
import { useToast } from '../../components/Toast';
import { SearchableMultiSelect } from '../../components/SearchableMultiSelect';
import { Switch } from '../../components/Switch';
import { useApiResource } from '../../hooks/use-api-resource';
import { requestJson } from '../../services/api-client';
import { CommandRuleEditor } from './CommandRuleEditor';
import {
  CAPABILITIES,
  buildActorOptions,
  buildSessionOptions,
  buildWorkspaceOptions,
  loadPermissionsData,
} from './permissions-helpers';

export function PermissionsPage() {
  const resource = useApiResource(loadPermissionsData);
  const dialog = useDialog();
  const [adding, setAdding] = useState(false);
  const [commandEnabled, setCommandEnabled] = useState(false);
  const { toast, success, error } = useToast();
  const [selectedActors, setSelectedActors] = useState<string[]>([]);
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<string[]>([]);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [v2ModalOpen, setV2ModalOpen] = useState(false);
  const [editingV2Row, setEditingV2Row] = useState<any | null>(null);
  const [v2WorkspaceId, setV2WorkspaceId] = useState<string>('');

  const closeAddRules = () => {
    setAdding(false);
    setCommandEnabled(false);
    setSelectedActors([]);
    setSelectedWorkspaceIds([]);
    setSelectedSessionIds([]);
  };

  const saveV2Rule = async (rule: CommandRuleV2) => {
    const targetWs = v2WorkspaceId || editingV2Row?.workspaceId || editingV2Row?.workspace_id;
    if (!targetWs && (!editingV2Row || editingV2Row.scope === 'workspace')) {
      error('Workspace is required for this rule');
      return;
    }
    try {
      const payload: any = editingV2Row
        ? {
            ...editingV2Row,
            workspaceId: targetWs,
            matcher: `${rule.application}:${rule.operation.join(':')}`,
            version: 2,
            predicate_json: JSON.stringify(rule),
          }
        : {
            effect: 'allow',
            capability: 'commands.run',
            scope: 'workspace',
            workspaceId: targetWs,
            matcher: `${rule.application}:${rule.operation.join(':')}`,
            version: 2,
            status: 'active',
            predicate_json: JSON.stringify(rule),
          };
      await requestJson('/api/permissions', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      success(editingV2Row ? 'Command rule updated.' : 'Command rule created.');
      setV2ModalOpen(false);
      setEditingV2Row(null);
      await resource.refresh();
    } catch (cause) {
      error(cause);
    }
  };

  const revoke = async (id: string) => {
    const confirmed = await dialog.confirm({
      title: 'Revoke permission rule',
      message: 'Revoke this permission rule? This cannot be undone.',
      confirmLabel: 'Revoke',
      confirmTone: 'danger',
    });
    if (!confirmed) return;
    try {
      await requestJson(`/api/permissions/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      success('Permission rule revoked.');
      await resource.refresh();
    } catch (cause) {
      error(cause);
    }
  };

  const createRules = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
      success('Permission rules created.');
      closeAddRules();
      await resource.refresh();
    } catch (cause) {
      error(cause);
    }
  };

  const workspaceOptions = buildWorkspaceOptions(resource.data?.workspaces);
  const sessionOptions = buildSessionOptions(resource.data?.sessions, resource.data?.workspaces);
  const actorOptions = buildActorOptions(
    resource.data?.connectors,
    resource.data?.connections,
    resource.data?.sessions,
  );

  return (
    <PageState loading={resource.loading} error={resource.error}>
      <section className="page-head">
        <div>
          <h2>Permissions</h2>
          <p>Create connector permission records and manage remembered rules.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="secondary"
            data-surface-id="permissions:add-typed"
            onClick={() => {
              setEditingV2Row(null);
              setV2WorkspaceId(resource.data?.workspaces?.[0]?.id ?? '');
              setV2ModalOpen(true);
            }}
          >
            Add typed rule
          </button>
          <button
            type="button"
            className="primary"
            data-surface-id="permissions:add"
            onClick={() => {
              setAdding(true);
            }}
          >
            Add rules
          </button>
        </div>
      </section>
      <ManagementModal open={adding} title="Add permission rules" onClose={closeAddRules}>
        <form className="permission-bulk permission-modal-form" onSubmit={createRules}>
          <section className="form-section">
            <h3>Who gets access?</h3>
            <p className="muted" style={{ margin: 0 }}>
              Grant capabilities to registered connectors, OAuth apps, or session actors.
            </p>
            <div className="field">
              <label htmlFor="connector-actors-input">Connector actors</label>
              <SearchableMultiSelect
                id="connector-actors-input"
                name="actors"
                placeholder="Search connector or enter actor (e.g. connector:ChatGPT, oauth:Claude)…"
                options={actorOptions}
                values={selectedActors}
                onChange={setSelectedActors}
              />
              <small>Select from registered connectors or enter custom actor IDs.</small>
            </div>
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
      <ManagementModal
        open={v2ModalOpen}
        title={editingV2Row ? 'Edit typed command rule' : 'Add typed command rule'}
        onClose={() => {
          setV2ModalOpen(false);
        }}
      >
        <div style={{ marginBottom: '0.75rem' }}>
          <label>
            <span
              style={{ display: 'block', fontSize: '0.8rem', opacity: 0.8, marginBottom: '0.2rem' }}
            >
              Target Workspace:
            </span>
            <Dropdown
              value={v2WorkspaceId}
              options={workspaceOptions}
              onChange={setV2WorkspaceId}
            />
          </label>
        </div>
        <CommandRuleEditor
          initialRule={
            editingV2Row
              ? typeof editingV2Row.predicate_json === 'string'
                ? JSON.parse(editingV2Row.predicate_json)
                : editingV2Row.predicate
              : undefined
          }
          onSave={saveV2Rule}
          onCancel={() => {
            setV2ModalOpen(false);
          }}
        />
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
              key: 'status',
              label: 'Status',
              render: (row: any) =>
                row.status === 'needs-review' ? (
                  <span style={{ color: '#f59e0b', fontWeight: 600 }}>needs-review</span>
                ) : row.version === 2 ? (
                  <span style={{ color: '#10b981' }}>v2</span>
                ) : (
                  <span>active</span>
                ),
            },
            {
              key: 'actions',
              label: '',
              sortable: false,
              search: false,
              render: (row) => (
                <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                  {row.version === 2 ? (
                    <button
                      type="button"
                      className="secondary"
                      aria-label="Edit"
                      title="Edit rule"
                      onClick={() => {
                        setEditingV2Row(row);
                        setV2WorkspaceId(
                          row.workspaceId ??
                            row.workspace_id ??
                            resource.data?.workspaces?.[0]?.id ??
                            '',
                        );
                        setV2ModalOpen(true);
                      }}
                    >
                      Edit
                    </button>
                  ) : null}
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
                </div>
              ),
            },
          ]}
          rowKey={(row) => row.id}
        />
      </section>
      {toast}
    </PageState>
  );
}
