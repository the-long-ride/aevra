import type { RemoteSessionSummary, WorkspaceSummary } from '@aevra/admin-contracts';
import { DataTable } from '../../components/DataTable';
import { PageState } from '../../components/PageState';
import { useApiResource } from '../../hooks/use-api-resource';
import { requestJson } from '../../services/api-client';

interface LocalSession extends Record<string, unknown> {
  idHash: string;
  createdAt?: string;
  lastUsedAt?: string;
}

interface SessionData {
  remote: Array<RemoteSessionSummary & Record<string, unknown>>;
  local: LocalSession[];
  workspaces: WorkspaceSummary[];
}

async function load(signal: AbortSignal): Promise<SessionData> {
  const [remote, local, workspaces] = await Promise.all([
    requestJson<RemoteSessionSummary[]>('/api/sessions', { signal }),
    requestJson<LocalSession[]>('/api/admin-sessions', { signal }),
    requestJson<WorkspaceSummary[]>('/api/workspaces', { signal }),
  ]);
  return {
    remote: remote.map((item) => ({
      ...item,
      workspaceId: item.lease?.workspaceId ?? '',
      workspaceState: item.activeLeaseId ? 'Workspace active' : 'No workspace',
    })),
    local,
    workspaces,
  };
}

export function SessionsPage() {
  const resource = useApiResource(load);
  const data = resource.data;

  const revokeRemote = async (id: string) => {
    await requestJson(`/api/sessions/${encodeURIComponent(id)}/revoke`, {
      method: 'POST',
      body: '{}',
    });
    await resource.refresh();
  };

  const switchWorkspace = async (id: string) => {
    const workspaceId = window.prompt(
      `Workspace ID\n${data?.workspaces.map((item) => `${item.name}: ${item.id}`).join('\n') ?? ''}`,
    );
    if (!workspaceId) return;
    await requestJson(`/api/sessions/${encodeURIComponent(id)}/workspace`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId, timeoutMs: 60000 }),
    });
    await resource.refresh();
  };

  const revokeLocal = async (idHash: string) => {
    await requestJson(`/api/admin-sessions/${encodeURIComponent(idHash)}/revoke`, {
      method: 'POST',
      body: '{}',
    });
    await resource.refresh();
  };

  const revokeOthers = async () => {
    if (
      !window.confirm('Revoke every non-connector MCP session and every other local admin session?')
    ) {
      return;
    }
    await requestJson('/api/sessions/revoke-others', {
      method: 'POST',
      body: '{}',
    });
    await resource.refresh();
  };

  return (
    <PageState loading={resource.loading} error={resource.error}>
      <section className="page-head">
        <div>
          <h2>Sessions</h2>
          <p>Manage MCP and local admin sessions.</p>
        </div>
        <button
          type="button"
          className="danger-button"
          data-surface-id="sessions:revoke-all-others"
          onClick={() => void revokeOthers()}
        >
          Revoke all others
        </button>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Remote MCP sessions</h3>
        </div>
        <DataTable
          id="react-remote-sessions"
          rows={data?.remote ?? []}
          pageSize={25}
          searchPlaceholder="Search remote sessions…"
          filters={[
            { key: 'actor', label: 'Actor' },
            { key: 'workspaceState', label: 'Workspace state' },
          ]}
          columns={[
            { key: 'actor', label: 'Actor' },
            { key: 'id', label: 'Session' },
            { key: 'workspaceId', label: 'Workspace' },
            { key: 'workspaceState', label: 'Workspace state' },
            { key: 'lastActivityAt', label: 'Last activity' },
            {
              key: 'actions',
              label: '',
              sortable: false,
              search: false,
              render: (row) => (
                <div className="actions">
                  <button
                    type="button"
                    data-surface-id="sessions:switch-workspace"
                    onClick={() => void switchWorkspace(row.id)}
                  >
                    Switch
                  </button>
                  <button
                    type="button"
                    data-surface-id="sessions:revoke"
                    onClick={() => void revokeRemote(row.id)}
                  >
                    Revoke
                  </button>
                </div>
              ),
            },
          ]}
          rowKey={(row) => row.id}
        />
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Local admin sessions</h3>
        </div>
        <DataTable
          id="react-local-sessions"
          rows={data?.local ?? []}
          pageSize={25}
          searchPlaceholder="Search admin sessions…"
          columns={[
            { key: 'idHash', label: 'Session hash' },
            { key: 'createdAt', label: 'Created' },
            { key: 'lastUsedAt', label: 'Last used' },
            {
              key: 'actions',
              label: '',
              sortable: false,
              search: false,
              render: (row) => (
                <button type="button" onClick={() => void revokeLocal(row.idHash)}>
                  Revoke
                </button>
              ),
            },
          ]}
          rowKey={(row) => row.idHash}
        />
      </section>
    </PageState>
  );
}
