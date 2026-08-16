import type { ConnectorSummary } from '@aevra/admin-contracts';
import { DataTable } from '../../components/DataTable';
import { useDialog } from '../../components/Dialog';
import { ManagementModal } from '../../components/ManagementModal';
import { ChangesPanel } from '../changes/ChangesPanel';
import { ProcessesPanel } from '../processes/ProcessesPanel';
import { requestJson } from '../../services/api-client';
import type { DashboardData } from './dashboard-service';
import type { RuntimeModalKind } from './RuntimeOverview';

const titles: Record<RuntimeModalKind, string> = {
  processes: 'Managed processes',
  changes: 'Open changes',
  tools: 'Tool calls',
  connectors: 'Connectors',
};

export function RuntimeManagementModal({
  kind,
  data,
  onClose,
  onRefresh,
  onCreateConnector,
}: {
  kind: RuntimeModalKind | null;
  data: DashboardData;
  onClose(): void;
  onRefresh(): Promise<void>;
  onCreateConnector(): void;
}) {
  const dialog = useDialog();

  const revokeConnector = async (connector: ConnectorSummary) => {
    if (
      !(await dialog.confirm({
        title: 'Revoke connector',
        message: `Revoke ${connector.name}?`,
        confirmLabel: 'Revoke',
        confirmTone: 'danger',
      }))
    ) {
      return;
    }
    await requestJson(`/api/connectors/${connector.id}`, { method: 'DELETE' });
    await onRefresh();
  };

  if (!kind) return null;

  return (
    <ManagementModal open title={titles[kind]} onClose={onClose}>
      {kind === 'processes' ? <ProcessesPanel /> : null}
      {kind === 'changes' ? <ChangesPanel /> : null}
      {kind === 'tools' ? (
        <DataTable
          id="react-dashboard-tools"
          rows={data.snapshot.metrics}
          columns={[
            { key: 'tool', label: 'Tool' },
            { key: 'calls', label: 'Calls' },
            { key: 'avgMs', label: 'Avg latency' },
            { key: 'totalMs', label: 'Total time' },
          ]}
          emptyText="No tool calls recorded in this runtime."
        />
      ) : null}
      {kind === 'connectors' ? (
        <>
          <div className="panel-toolbar">
            <p>OAuth is recommended. Static Bearer connectors remain available when needed.</p>
            <button
              type="button"
              data-surface-id="connections:create-connector"
              onClick={onCreateConnector}
            >
              New connector
            </button>
          </div>
          <DataTable
            id="react-dashboard-connectors"
            rows={data.snapshot.connectors}
            columns={[
              { key: 'name', label: 'Connector' },
              { key: 'authType', label: 'Auth' },
              { key: 'createdAt', label: 'Created', dateTime: true },
              { key: 'lastUsedAt', label: 'Last used', dateTime: true },
              {
                key: 'actions',
                label: '',
                sortable: false,
                search: false,
                render: (row) =>
                  row.revocable === false ? (
                    ''
                  ) : (
                    <button
                      type="button"
                      data-surface-id="connections:revoke-connector"
                      onClick={() => void revokeConnector(row)}
                    >
                      Revoke
                    </button>
                  ),
              },
            ]}
          />
        </>
      ) : null}
    </ManagementModal>
  );
}
