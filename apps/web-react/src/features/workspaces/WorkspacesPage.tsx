import { useWorkspaceRows, useCopiedWorkspaceId, type WorkspaceRow } from './workspace-data';
import { useEffect, useState } from 'react';
import { Dropdown } from '../../components/Dropdown';
import { DataTable } from '../../components/DataTable';
import { useDialog } from '../../components/Dialog';
import { useModalLayer } from '../../components/modal-layer';
import { PageState } from '../../components/PageState';
import { useToast } from '../../components/Toast';
import { requestJson } from '../../services/api-client';
import { AddWorkspaceModal } from './AddWorkspaceModal';
import { CopyIcon, DetailIcon } from './WorkspaceIcons';
import { SearchableMultiSelect, type SearchOption } from '../../components/SearchableMultiSelect';
import { buildActorOptions } from '../permissions/permissions-helpers';

interface WorkspaceAdmission {
  actor: string;
  workspaceId: string;
  profileId: string;
  admission: 'auto' | 'ask';
  profileName?: string;
}

const ADMISSION_PROFILE_OPTIONS = [
  { value: 'read-only', label: 'Read Only' },
  { value: 'coding-session', label: 'Coding Session' },
  { value: 'developer', label: 'Developer' },
  { value: 'full-workspace', label: 'Full Workspace' },
];

const ADMISSION_MODE_OPTIONS = [
  { value: 'auto', label: 'Auto-admit' },
  { value: 'ask', label: 'Ask every time' },
];

const MOUNT_CAPABILITY_OPTIONS = [
  { value: 'read-only', label: 'Read Only' },
  { value: 'read-write', label: 'Read & Write' },
  { value: 'full', label: 'Full Access' },
];

const MOUNT_CAPABILITY_MAP: Record<string, string[]> = {
  'read-only': ['files.read', 'files.search'],
  'read-write': ['files.read', 'files.search', 'files.write', 'files.delete'],
  full: ['files.read', 'files.search', 'files.write', 'files.delete', 'commands.run'],
};

function getMountCapabilityPreset(capabilities?: string[]): string {
  if (!capabilities || capabilities.length === 0) return 'read-only';
  if (capabilities.includes('commands.run')) return 'full';
  if (capabilities.includes('files.write') || capabilities.includes('files.delete')) {
    return 'read-write';
  }
  return 'read-only';
}

export function WorkspacesPage() {
  const resource = useWorkspaceRows();
  const { copiedId, copyWorkspaceId } = useCopiedWorkspaceId();
  const dialog = useDialog();
  const { toast, success, error } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [selectedActors, setSelectedActors] = useState<string[]>([]);
  const [actorOptions, setActorOptions] = useState<SearchOption[]>([]);
  const [admissions, setAdmissions] = useState<WorkspaceAdmission[]>([]);
  const { ref: detailLayerRef } = useModalLayer();
  const selected = resource.data?.find((workspace) => workspace.id === selectedId) ?? null;

  useEffect(() => {
    let active = true;
    Promise.all([
      requestJson<Array<{ id?: string; name?: string }>>('/api/connectors').catch(() => []),
      requestJson<Array<{ id?: string; client?: string; actor?: string }>>('/api/connections').catch(() => []),
      requestJson<Array<{ id?: string; actor?: string }>>('/api/sessions').catch(() => []),
    ]).then(([connectors, connections, sessions]) => {
      if (active) {
        setActorOptions(buildActorOptions(connectors, connections, sessions as any));
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const refreshAdmissions = async (workspaceId: string) => {
    try {
      const data = await requestJson<WorkspaceAdmission[]>(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/admissions`,
      );
      setAdmissions(Array.isArray(data) ? data : []);
    } catch {
      setAdmissions([]);
    }
  };

  useEffect(() => {
    if (!selected?.id) {
      setAdmissions([]);
      setSelectedActors([]);
      return;
    }
    void refreshAdmissions(selected.id);
  }, [selected?.id]);

  const removeWorkspace = async (row: WorkspaceRow) => {
    if (
      !(await dialog.confirm({
        title: 'Remove workspace',
        message: `Remove ${row.name} from Aevra?`,
        confirmLabel: 'Remove',
        confirmTone: 'danger',
      }))
    ) {
      return;
    }
    try {
      await requestJson(`/api/workspaces/${encodeURIComponent(row.id)}`, {
        method: 'DELETE',
      });
      if (selectedId === row.id) setSelectedId(null);
      success(`Workspace "${row.name}" removed.`);
      await resource.refresh();
    } catch (cause) {
      error(cause);
    }
  };

  const saveWorkspaceDetails = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const hostRoot = String(data.hostRoot ?? '').trim();
    const update = {
      name: String(data.name ?? '').trim(),
      description: String(data.description ?? '').trim(),
      ...(hostRoot !== String(selected.hostRoot ?? '').trim() ? { hostRoot } : {}),
    };
    try {
      await requestJson(`/api/workspaces/${encodeURIComponent(selected.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(update),
      });
      success('Workspace updated.');
      await resource.refresh();
    } catch (cause) {
      error(cause);
    }
  };

  const addMount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const rawHostRoot = String(data.hostRoot ?? '').trim();
    const rawLogicalPath = String(data.logicalPath ?? '').trim();
    const hostRoot = rawHostRoot || rawLogicalPath;
    const logicalPath = rawLogicalPath || hostRoot;
    if (!hostRoot) return;
    const preset = String(data.capabilities ?? 'read-only');
    const capabilities = MOUNT_CAPABILITY_MAP[preset] ?? ['files.read', 'files.search'];
    try {
      await requestJson(`/api/workspaces/${encodeURIComponent(selected.id)}/mounts`, {
        method: 'POST',
        body: JSON.stringify({
          logicalPath,
          hostRoot,
          capabilities,
        }),
      });
      success('External mount added.');
      await resource.refresh();
    } catch (cause) {
      error(cause);
    }
  };

  const updateMountCapabilities = async (mountId: string, preset: string) => {
    const capabilities = MOUNT_CAPABILITY_MAP[preset] ?? ['files.read', 'files.search'];
    try {
      await requestJson(`/api/mounts/${encodeURIComponent(mountId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ capabilities }),
      });
      success('External mount updated.');
      await resource.refresh();
    } catch (cause) {
      error(cause);
    }
  };

  const removeMount = async (mountId: string) => {
    if (
      !(await dialog.confirm({
        title: 'Remove external mount',
        message: 'Remove this external mount registration?',
        confirmLabel: 'Remove',
        confirmTone: 'danger',
      }))
    ) {
      return;
    }
    try {
      await requestJson(`/api/mounts/${encodeURIComponent(mountId)}`, {
        method: 'DELETE',
      });
      success('External mount removed.');
      await resource.refresh();
    } catch (cause) {
      error(cause);
    }
  };

  const updateActorAdmission = async (
    actor: string,
    profileId: string,
    admission: 'auto' | 'ask',
  ) => {
    if (!selected) return;
    try {
      await requestJson(`/api/workspaces/${encodeURIComponent(selected.id)}/admission`, {
        method: 'POST',
        body: JSON.stringify({ actor, profileId, admission }),
      });
      success(`Admission updated for "${actor}".`);
      await refreshAdmissions(selected.id);
    } catch (cause) {
      error(cause);
    }
  };

  const revokeAdmission = async (actor: string) => {
    if (!selected) return;
    if (
      !(await dialog.confirm({
        title: 'Remove actor admission',
        message: `Remove admission for "${actor}" from this workspace?`,
        confirmLabel: 'Remove',
        confirmTone: 'danger',
      }))
    ) {
      return;
    }
    try {
      await requestJson(
        `/api/workspaces/${encodeURIComponent(selected.id)}/admission/${encodeURIComponent(actor)}`,
        {
          method: 'DELETE',
        },
      );
      success(`Admission removed for "${actor}".`);
      await refreshAdmissions(selected.id);
    } catch (cause) {
      error(cause);
    }
  };

  const saveAdmission = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const formData = new FormData(event.currentTarget);
    const rawFormActor = String(formData.get('actor') ?? '').trim();
    const actorInputEl = event.currentTarget.querySelector<HTMLInputElement>('#admission-actor-input');
    const typedQuery = actorInputEl?.value?.trim() ?? '';
    const profileId = String(formData.get('profileId') ?? 'developer');
    const admission = formData.get('admission') === 'ask' ? 'ask' : 'auto';

    const rawActorString = selectedActors.length > 0 ? '' : rawFormActor || typedQuery;
    const actorsToSave =
      selectedActors.length > 0
        ? selectedActors
        : rawActorString
          ? rawActorString.split(',').map((s) => s.trim()).filter(Boolean)
          : [];

    if (actorsToSave.length === 0) return;

    try {
      for (const actor of actorsToSave) {
        await requestJson(`/api/workspaces/${encodeURIComponent(selected.id)}/admission`, {
          method: 'POST',
          body: JSON.stringify({ actor, profileId, admission }),
        });
      }
      setSelectedActors([]);
      if (actorInputEl) actorInputEl.value = '';
      success('Admission policy saved.');
      await refreshAdmissions(selected.id);
    } catch (cause) {
      error(cause);
    }
  };

  return (
    <PageState loading={resource.loading} error={resource.error}>
      <section className="page-head">
        <div>
          <h2>Workspaces</h2>
          <p>
            Primary project roots with optional external directory mounts and connector admission.
          </p>
        </div>
        <button
          type="button"
          className="primary"
          data-surface-id="workspaces:add"
          onClick={() => setAdding(true)}
        >
          Add workspace
        </button>
      </section>
      <section className="panel">
        <DataTable
          id="react-workspaces-admin"
          rows={resource.data ?? []}
          pageSize={25}
          searchPlaceholder="Search workspaces…"
          filters={[{ key: 'mountState', label: 'External mounts' }]}
          columns={[
            { key: 'name', label: 'Workspace' },
            { key: 'hostRoot', label: 'Local root' },
            { key: 'mountCount', label: 'Mounts' },
            { key: 'description', label: 'Description' },
            {
              key: 'actions',
              label: '',
              sortable: false,
              search: false,
              render: (row) => (
                <div className="actions workspace-row-actions">
                  <button
                    type="button"
                    aria-label={copiedId === row.id ? 'Copied' : 'Copy ID'}
                    title={copiedId === row.id ? 'Copied' : 'Copy ID'}
                    data-surface-id="workspaces:copy-id"
                    onClick={() => void copyWorkspaceId(row.id)}
                  >
                    {copiedId === row.id ? 'Copied' : <CopyIcon />}
                  </button>
                  <button
                    type="button"
                    aria-label="Details"
                    title="Details"
                    data-surface-id="workspaces:details"
                    onClick={() => setSelectedId(row.id)}
                  >
                    <DetailIcon />
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    aria-label="Remove"
                    title="Remove"
                    data-surface-id="workspaces:remove"
                    onClick={() => void removeWorkspace(row)}
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
      {adding ? (
        <AddWorkspaceModal
          onClose={() => setAdding(false)}
          onCreated={async () => {
            success('Workspace created.');
            await resource.refresh();
          }}
        />
      ) : null}
      {selected ? (
        <div
          ref={detailLayerRef}
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setSelectedId(null);
          }}
        >
          <section
            className="modal workspace-details-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="workspace-details-title"
          >
            <div className="modal-head">
              <h3 id="workspace-details-title">{selected.name}</h3>
              <button type="button" onClick={() => setSelectedId(null)}>
                Close
              </button>
            </div>
            <div className="modal-body workspace-details-body">
              <section className="form-section">
                <form
                  className="workspace-details-form"
                  key={selected.id}
                  onSubmit={saveWorkspaceDetails}
                >
                  <label className="field">
                    <span>Workspace name</span>
                    <input name="name" defaultValue={selected.name} required />
                  </label>
                  <label className="field">
                    <span>Description</span>
                    <input
                      name="description"
                      defaultValue={selected.description ?? ''}
                      placeholder="Describe this workspace"
                    />
                  </label>
                  <label className="field workspace-root-field">
                    <span>Root local path</span>
                    <input name="hostRoot" defaultValue={selected.hostRoot ?? ''} required />
                  </label>
                  <div className="workspace-details-actions">
                    <button className="primary" data-surface-id="workspaces:save-details">
                      Save changes
                    </button>
                  </div>
                </form>
              </section>
              <div className="details-grid">
                <div>
                  <span>Local root</span>
                  <strong>{selected.hostRoot ?? '—'}</strong>
                </div>
                <div>
                  <span>External mounts</span>
                  <strong>{selected.mountCount}</strong>
                </div>
              </div>
              <section className="form-section">
                <h3>External mounts</h3>
                <form className="form-row" onSubmit={addMount}>
                  <label className="field">
                    <span>Logical path</span>
                    <input
                      name="logicalPath"
                      placeholder="Optional (/shared or absolute path)"
                    />
                  </label>
                  <label className="field">
                    <span>Local mount root</span>
                    <input
                      name="hostRoot"
                      placeholder="Absolute path (e.g. D:\shared or /opt/shared)"
                    />
                  </label>
                  <label className="field">
                    <span>Capabilities</span>
                    <Dropdown
                      name="capabilities"
                      ariaLabel="Capabilities"
                      defaultValue="read-only"
                      options={MOUNT_CAPABILITY_OPTIONS}
                    />
                  </label>
                  <button className="primary" data-surface-id="workspaces:add-mount">
                    Add mount
                  </button>
                </form>
                <DataTable
                  id="react-workspace-mounts"
                  rows={selected.mounts}
                  columns={[
                    { key: 'logicalPath', label: 'Logical path' },
                    { key: 'hostRoot', label: 'Local root' },
                    {
                      key: 'capabilities',
                      label: 'Capabilities',
                      render: (row) => (
                        <Dropdown
                          className="mount-capability-dropdown"
                          ariaLabel={`Capabilities for ${row.logicalPath || row.hostRoot}`}
                          value={getMountCapabilityPreset(row.capabilities)}
                          onChange={(val) => void updateMountCapabilities(row.id, val)}
                          options={MOUNT_CAPABILITY_OPTIONS}
                        />
                      ),
                    },
                    {
                      key: 'actions',
                      label: '',
                      sortable: false,
                      search: false,
                      render: (row) => (
                        <button
                          type="button"
                          className="danger-button"
                          aria-label="Remove"
                          title="Remove"
                          data-surface-id="workspaces:remove-mount"
                          onClick={() => void removeMount(row.id)}
                        >
                          [x]
                        </button>
                      ),
                    },
                  ]}
                  rowKey={(row) => row.id}
                  emptyText="No external mounts."
                />
              </section>
              <section className="form-section">
                <h3>Actor admission</h3>
                <DataTable
                  id="react-workspace-admissions"
                  rows={admissions}
                  columns={[
                    {
                      key: 'actor',
                      label: 'Actor',
                      value: (row) => row.actor,
                    },
                    {
                      key: 'profileId',
                      label: 'Profile',
                      render: (row) => (
                        <Dropdown
                          className="admission-profile-dropdown"
                          ariaLabel={`Profile for ${row.actor}`}
                          value={row.profileId}
                          onChange={(val) => void updateActorAdmission(row.actor, val, row.admission)}
                          options={ADMISSION_PROFILE_OPTIONS}
                        />
                      ),
                    },
                    {
                      key: 'admission',
                      label: 'Admission',
                      render: (row) => (
                        <Dropdown
                          className="admission-mode-dropdown"
                          ariaLabel={`Admission policy for ${row.actor}`}
                          value={row.admission}
                          onChange={(val) =>
                            void updateActorAdmission(row.actor, row.profileId, val as 'auto' | 'ask')
                          }
                          options={ADMISSION_MODE_OPTIONS}
                        />
                      ),
                    },
                    {
                      key: 'actions',
                      label: '',
                      sortable: false,
                      search: false,
                      render: (row) => (
                        <button
                          type="button"
                          className="danger-button"
                          aria-label="Remove"
                          title="Remove"
                          data-surface-id="workspaces:revoke-admission"
                          onClick={() => void revokeAdmission(row.actor)}
                        >
                          [x]
                        </button>
                      ),
                    },
                  ]}
                  rowKey={(row) => row.actor}
                  emptyText="No admitted actors."
                />
                <form className="form-row" onSubmit={saveAdmission}>
                  <div className="field">
                    <label htmlFor="admission-actor-input">Actor</label>
                    <SearchableMultiSelect
                      id="admission-actor-input"
                      name="actor"
                      placeholder="Search connector or enter actor (e.g. connector:ChatGPT)…"
                      options={actorOptions}
                      values={selectedActors}
                      onChange={setSelectedActors}
                    />
                  </div>
                  <label className="field">
                    <span>Profile</span>
                    <Dropdown
                      name="profileId"
                      ariaLabel="Profile"
                      defaultValue="developer"
                      options={ADMISSION_PROFILE_OPTIONS}
                    />
                  </label>
                  <label className="field">
                    <span>Admission</span>
                    <Dropdown
                      name="admission"
                      ariaLabel="Admission"
                      defaultValue="auto"
                      options={ADMISSION_MODE_OPTIONS}
                    />
                  </label>
                  <button className="primary" data-surface-id="workspaces:save-admission">
                    Save admission
                  </button>
                </form>
              </section>
            </div>
          </section>
        </div>
      ) : null}
      {toast}
    </PageState>
  );
}
