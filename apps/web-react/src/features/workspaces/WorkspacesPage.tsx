import type { WorkspaceSummary } from '@aevra/admin-contracts';
import { useState } from 'react';
import { Dropdown } from '../../components/Dropdown';
import { DataTable } from '../../components/DataTable';
import { useDialog } from '../../components/Dialog';
import { PageState } from '../../components/PageState';
import { useApiResource } from '../../hooks/use-api-resource';
import { requestJson } from '../../services/api-client';
import { AddWorkspaceModal } from './AddWorkspaceModal';

interface WorkspaceMount extends Record<string, unknown> {
  id: string;
  logicalPath?: string;
  hostRoot?: string;
  capabilities?: string[];
  sensitivityPolicyId?: string;
}

interface WorkspaceRow extends WorkspaceSummary, Record<string, unknown> {
  mounts: WorkspaceMount[];
  mountCount: number;
  mountState: string;
}

async function load(signal: AbortSignal): Promise<WorkspaceRow[]> {
  const workspaces = await requestJson<WorkspaceSummary[]>('/api/workspaces', {
    signal,
  });
  return Promise.all(
    workspaces.map(async (workspace) => {
      const mounts = await requestJson<WorkspaceMount[]>(
        `/api/workspaces/${encodeURIComponent(workspace.id)}/mounts`,
        { signal },
      );
      return {
        ...workspace,
        mounts,
        mountCount: mounts.length,
        mountState: mounts.length ? 'Has mounts' : 'No mounts',
      };
    }),
  );
}

export function WorkspacesPage() {
  const resource = useApiResource(load);
  const dialog = useDialog();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const selected = resource.data?.find((workspace) => workspace.id === selectedId) ?? null;

  const copyWorkspaceId = async (id: string) => {
    await navigator.clipboard.writeText(id);
    setCopiedId(id);
    window.setTimeout(() => {
      setCopiedId((current) => (current === id ? null : current));
    }, 1600);
  };
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
    await requestJson(`/api/workspaces/${encodeURIComponent(row.id)}`, {
      method: 'DELETE',
    });
    if (selectedId === row.id) setSelectedId(null);
    await resource.refresh();
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
    await requestJson(`/api/workspaces/${encodeURIComponent(selected.id)}`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    });
    await resource.refresh();
  };

  const addMount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const data = Object.fromEntries(new FormData(event.currentTarget));
    await requestJson(`/api/workspaces/${encodeURIComponent(selected.id)}/mounts`, {
      method: 'POST',
      body: JSON.stringify({
        logicalPath: data.logicalPath,
        hostRoot: data.hostRoot,
        capabilities: ['files.read', 'files.search'],
      }),
    });
    await resource.refresh();
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
    await requestJson(`/api/mounts/${encodeURIComponent(mountId)}`, {
      method: 'DELETE',
    });
    await resource.refresh();
  };

  const saveAdmission = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    await requestJson(`/api/workspaces/${encodeURIComponent(selected.id)}/admission`, {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
    });
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
                <div className="actions">
                  <button
                    type="button"
                    data-surface-id="workspaces:copy-id"
                    onClick={() => void copyWorkspaceId(row.id)}
                  >
                    {copiedId === row.id ? 'Copied' : 'Copy ID'}
                  </button>
                  <button
                    type="button"
                    data-surface-id="workspaces:details"
                    onClick={() => setSelectedId(row.id)}
                  >
                    Details
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    data-surface-id="workspaces:remove"
                    onClick={() => void removeWorkspace(row)}
                  >
                    Remove
                  </button>
                </div>
              ),
            },
          ]}
          rowKey={(row) => row.id}
        />
      </section>
      {adding ? (
        <AddWorkspaceModal onClose={() => setAdding(false)} onCreated={() => resource.refresh()} />
      ) : null}
      {selected ? (
        <div
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
                <h3>Workspace details</h3>
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
                    <input name="logicalPath" required />
                  </label>
                  <label className="field">
                    <span>Local mount root</span>
                    <input name="hostRoot" required />
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
                      value: (row) => (row.capabilities ?? []).join(', '),
                    },
                    {
                      key: 'sensitivityPolicyId',
                      label: 'Sensitivity',
                      value: (row) => row.sensitivityPolicyId ?? 'Default',
                    },
                    {
                      key: 'actions',
                      label: '',
                      sortable: false,
                      search: false,
                      render: (row) => (
                        <button
                          type="button"
                          data-surface-id="workspaces:remove-mount"
                          onClick={() => void removeMount(row.id)}
                        >
                          Remove
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
                <form className="form-row" onSubmit={saveAdmission}>
                  <label className="field">
                    <span>Actor</span>
                    <input name="actor" placeholder="connector:ChatGPT" required />
                  </label>
                  <label className="field">
                    <span>Profile</span>
                    <Dropdown
                      name="profileId"
                      ariaLabel="Profile"
                      defaultValue="developer"
                      options={[
                        { value: 'read-only', label: 'Read Only' },
                        { value: 'developer', label: 'Developer' },
                        { value: 'full-workspace', label: 'Full Workspace' },
                      ]}
                    />
                  </label>
                  <label className="field">
                    <span>Admission</span>
                    <Dropdown
                      name="admission"
                      ariaLabel="Admission"
                      defaultValue="auto"
                      options={[
                        { value: 'auto', label: 'Auto-admit' },
                        { value: 'ask', label: 'Ask every time' },
                      ]}
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
    </PageState>
  );
}
