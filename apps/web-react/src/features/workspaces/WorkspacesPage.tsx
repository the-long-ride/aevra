import type { WorkspaceSummary } from '@aevra/admin-contracts';
import { useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { PageState } from '../../components/PageState';
import { useApiResource } from '../../hooks/use-api-resource';
import { requestJson } from '../../services/api-client';

interface WorkspaceRow extends WorkspaceSummary, Record<string, unknown> {
  mountCount: number;
  mountState: string;
}

async function load(signal: AbortSignal): Promise<WorkspaceRow[]> {
  const workspaces = await requestJson<WorkspaceSummary[]>('/api/workspaces', {
    signal,
  });
  return Promise.all(
    workspaces.map(async (workspace) => {
      const mounts = await requestJson<unknown[]>(
        `/api/workspaces/${encodeURIComponent(workspace.id)}/mounts`,
        { signal },
      );
      return {
        ...workspace,
        mountCount: mounts.length,
        mountState: mounts.length ? 'Has mounts' : 'No mounts',
      };
    }),
  );
}

export function WorkspacesPage() {
  const resource = useApiResource(load);
  const [selected, setSelected] = useState<WorkspaceRow | null>(null);

  const addWorkspace = async () => {
    const name = window.prompt('Workspace name');
    if (!name?.trim()) return;
    const hostRoot = window.prompt('Absolute local project path');
    if (!hostRoot?.trim()) return;
    await requestJson('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name: name.trim(), hostRoot: hostRoot.trim() }),
    });
    await resource.refresh();
  };

  const removeWorkspace = async (row: WorkspaceRow) => {
    if (!window.confirm('Remove this workspace registration?')) return;
    await requestJson(`/api/workspaces/${encodeURIComponent(row.id)}`, {
      method: 'DELETE',
    });
    if (selected?.id === row.id) setSelected(null);
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

  const saveAdmission = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    await requestJson(
      `/api/workspaces/${encodeURIComponent(selected.id)}/admission`,
      {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
      },
    );
  };

  return (
    <PageState loading={resource.loading} error={resource.error}>
      <section className="page-head">
        <div>
          <h2>Workspaces</h2>
          <p>Primary project roots with optional external directory mounts and connector admission.</p>
        </div>
        <button type="button" className="primary" data-surface-id="workspaces:add" onClick={() => void addWorkspace()}>
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
                  <button type="button" data-surface-id="workspaces:details" onClick={() => setSelected(row)}>
                    Details
                  </button>
                  <button type="button" className="danger-button" data-surface-id="workspaces:remove" onClick={() => void removeWorkspace(row)}>
                    Remove
                  </button>
                </div>
              ),
            },
          ]}
          rowKey={(row) => row.id}
        />
      </section>
      {selected ? (
        <section className="panel">
          <div className="panel-head"><h3>{selected.name}</h3><button type="button" onClick={() => setSelected(null)}>Close</button></div>
          <div className="details-grid">
            <div><span>Local root</span><strong>{selected.hostRoot ?? '—'}</strong></div>
            <div><span>External mounts</span><strong>{selected.mountCount}</strong></div>
          </div>
          <section className="form-section">
            <h3>External mounts</h3>
            <form className="form-row" onSubmit={addMount}>
              <label className="field"><span>Logical path</span><input name="logicalPath" required /></label>
              <label className="field"><span>Local mount root</span><input name="hostRoot" required /></label>
              <button className="primary" data-surface-id="workspaces:add-mount">Add mount</button>
            </form>
          </section>
          <section className="form-section">
            <h3>Actor admission</h3>
            <form className="form-row" onSubmit={saveAdmission}>
              <label className="field"><span>Actor</span><input name="actor" placeholder="connector:ChatGPT" required /></label>
              <label className="field"><span>Profile</span><select name="profileId" defaultValue="developer"><option value="read-only">Read Only</option><option value="developer">Developer</option><option value="full-workspace">Full Workspace</option></select></label>
              <label className="field"><span>Admission</span><select name="admission"><option value="auto">Auto-admit</option><option value="ask">Ask every time</option></select></label>
              <button className="primary" data-surface-id="workspaces:save-admission">Save admission</button>
            </form>
          </section>
        </section>
      ) : null}
    </PageState>
  );
}
