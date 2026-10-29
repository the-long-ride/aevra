import { useWorkspaceRows, useCopiedWorkspaceId, type WorkspaceRow } from './workspace-data';
import { useState } from 'react';
import { Dropdown } from '../../components/Dropdown';
import { DataTable } from '../../components/DataTable';
import { useDialog } from '../../components/Dialog';
import { useModalLayer } from '../../components/modal-layer';
import { PageState } from '../../components/PageState';
import { useToast } from '../../components/Toast';
import { requestJson } from '../../services/api-client';
import { AddWorkspaceModal } from './AddWorkspaceModal';
import { CopyIcon, DetailIcon } from './WorkspaceIcons';
import { WorkspaceAdmissionsSection } from './WorkspaceAdmissionsSection';
import {
  MOUNT_CAPABILITY_MAP,
  MOUNT_CAPABILITY_OPTIONS,
  getMountCapabilityPreset,
} from './workspace-options';

export function WorkspacesPage() {
  const resource = useWorkspaceRows();
  const { copiedId, copyWorkspaceId } = useCopiedWorkspaceId();
  const dialog = useDialog();
  const { toast, success, error } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const { ref: detailLayerRef } = useModalLayer();
  const selected = resource.data?.find((workspace) => workspace.id === selectedId) ?? null;

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
                    <input name="logicalPath" placeholder="Optional (/shared or absolute path)" />
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
              <WorkspaceAdmissionsSection
                key={selected.id}
                workspaceId={selected.id}
                success={success}
                error={error}
              />
            </div>
          </section>
        </div>
      ) : null}
      {toast}
    </PageState>
  );
}
