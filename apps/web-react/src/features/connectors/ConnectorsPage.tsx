import { useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { useDialog } from '../../components/Dialog';
import { PageState } from '../../components/PageState';
import { Switch } from '../../components/Switch';
import { useToast } from '../../components/Toast';
import { useApiResource } from '../../hooks/use-api-resource';
import { ConnectionDetailModal } from '../dashboard/ConnectionDetailModal';
import { ConnectorModal } from '../dashboard/ConnectorModal';
import { loadConnectorsData, removeConnectorItem, type ConnectorItem } from './connectors-service';

export function ConnectorsPage() {
  const resource = useApiResource(loadConnectorsData);
  const dialog = useDialog();
  const { toast, success, error } = useToast();

  const [selectedConnectorIds, setSelectedConnectorIds] = useState<Set<string>>(new Set());
  const [revoking, setRevoking] = useState(false);
  const [selectedConnector, setSelectedConnector] = useState<ConnectorItem | null>(null);
  const [addingConnector, setAddingConnector] = useState(false);

  const connectors = resource.data?.connectors ?? [];
  const workspaces = resource.data?.workspaces ?? [];

  const selectedLive = selectedConnector?.id
    ? (connectors.find((row) => row.id === selectedConnector.id) ?? selectedConnector)
    : null;

  const selectableIds = connectors.filter((row) => row.revocable).map((row) => row.id);

  const selectedRows = connectors.filter((row) => selectedConnectorIds.has(row.id));

  const toggleConnector = (id: string, checked: boolean) => {
    setSelectedConnectorIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedConnectorIds(new Set(selectableIds));
  };

  const unselectAll = () => {
    setSelectedConnectorIds(new Set());
  };

  const revokeSelected = async () => {
    if (!selectedRows.length || revoking) return;
    const count = selectedRows.length;
    const confirmed = await dialog.confirm({
      title: 'Revoke selected connectors',
      message: `Revoke ${count} selected connector${count === 1 ? '' : 's'}?`,
      confirmLabel: 'Revoke selected',
      confirmTone: 'danger',
    });
    if (!confirmed) return;

    setRevoking(true);
    try {
      const results = await Promise.allSettled(selectedRows.map((row) => removeConnectorItem(row)));
      const succeeded = new Set(
        selectedRows
          .filter((_, index) => results[index]?.status === 'fulfilled')
          .map((row) => row.id),
      );
      const failed = count - succeeded.size;

      setSelectedConnectorIds(
        (current) => new Set([...current].filter((id) => !succeeded.has(id))),
      );
      if (selectedConnector?.id && succeeded.has(selectedConnector.id)) {
        setSelectedConnector(null);
      }
      if (succeeded.size) {
        success(`${succeeded.size} connector${succeeded.size === 1 ? '' : 's'} revoked.`);
      }
      await resource.refresh();

      if (failed) {
        void dialog.message({
          title: 'Connector revocation',
          actionLabel: 'Close',
          message: `${succeeded.size} connector${succeeded.size === 1 ? '' : 's'} revoked; ${failed} failed.`,
        });
      }
    } finally {
      setRevoking(false);
    }
  };

  const revokeSingle = async (row: ConnectorItem) => {
    const clientName = row.client || row.name || 'connector';
    const confirmed = await dialog.confirm({
      title: 'Revoke connector',
      message: `Revoke ${clientName}?`,
      confirmLabel: 'Revoke',
      confirmTone: 'danger',
    });
    if (!confirmed) return;

    try {
      await removeConnectorItem(row);
      setSelectedConnectorIds((current) => {
        const next = new Set(current);
        next.delete(row.id);
        return next;
      });
      if (selectedConnector?.id === row.id) setSelectedConnector(null);
      success('Connector revoked.');
      await resource.refresh();
    } catch (err: unknown) {
      error(err);
      void dialog.message({
        title: 'Revocation failed',
        actionLabel: 'Close',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <PageState loading={resource.loading && !resource.data} error={resource.error}>
      <section className="page-head">
        <div>
          <h2>Connectors</h2>
          <p>Client connectors, authentication, and access grants.</p>
        </div>
        <button
          type="button"
          className="primary"
          data-surface-id="connections:create-connector"
          onClick={() => setAddingConnector(true)}
        >
          New connector
        </button>
      </section>

      {connectors.some((row) => row.yolo) ? (
        <p className="warning">
          YOLO enabled — immutable security approvals still require confirmation
        </p>
      ) : null}

      <div className="active-connections-toolbar">
        <div className="active-connections-toolbar-actions">
          <span>
            {selectedRows.length
              ? `${selectedRows.length} selected`
              : 'Select one or more connectors to revoke'}
          </span>
          <div className="active-connections-selection-controls">
            <button
              type="button"
              className="compact-button"
              disabled={!selectableIds.length || selectedRows.length === selectableIds.length}
              onClick={selectAll}
            >
              Select all
            </button>
            <button
              type="button"
              className="compact-button"
              disabled={!selectedRows.length}
              onClick={unselectAll}
            >
              Unselect all
            </button>
          </div>
        </div>
        <button
          type="button"
          className="danger-button"
          disabled={!selectedRows.length || revoking}
          onClick={() => void revokeSelected()}
        >
          {revoking ? 'Revoking…' : 'Revoke selected'}
        </button>
      </div>

      <DataTable
        id="react-connectors-admin"
        rows={connectors}
        pageSize={25}
        searchPlaceholder="Search connectors…"
        filters={[
          { key: 'authType', label: 'Auth' },
          { key: 'status', label: 'Status' },
        ]}
        columns={[
          {
            key: 'select',
            label: 'Select',
            sortable: false,
            search: false,
            render: (row: ConnectorItem) => {
              if (!row.revocable) return null;
              const label = `Select ${row.client}`;
              return (
                <Switch
                  label={<span className="sr-only">{label}</span>}
                  containerClassName="connection-select"
                  aria-label={label}
                  checked={selectedConnectorIds.has(row.id)}
                  onChange={(event) => toggleConnector(row.id, event.currentTarget.checked)}
                />
              );
            },
          },
          { key: 'client', label: 'Client' },
          { key: 'authType', label: 'Auth' },
          {
            key: 'status',
            label: 'Status',
            value: (row: ConnectorItem) => row.status,
            render: (row: ConnectorItem) => (
              <span className={row.status === 'CONNECTED' ? 'badge good' : 'badge muted'}>
                {row.status}
              </span>
            ),
          },
          {
            key: 'yolo',
            label: 'Mode',
            value: (row: ConnectorItem) => (row.yolo ? 'YOLO' : ''),
            render: (row: ConnectorItem) =>
              row.yolo ? (
                <span
                  className="badge good"
                  title="YOLO enabled — immutable security approvals still require confirmation"
                >
                  YOLO
                </span>
              ) : null,
          },
          {
            key: 'workspace',
            label: 'Workspace',
            value: (row: ConnectorItem) => row.workspace ?? '—',
          },
          {
            key: 'capabilities',
            label: 'Capabilities',
            value: (row: ConnectorItem) =>
              Array.isArray(row.capabilities)
                ? row.capabilities.join(', ')
                : String(row.capabilities ?? ''),
            render: (row: ConnectorItem) => {
              const caps = row.capabilities ?? [];
              if (!caps.length) return null;
              const fullText = caps.join(', ');
              const showCaps = () =>
                void dialog.message({
                  title: 'Capabilities',
                  message: (
                    <div
                      className="dialog-capabilities-list"
                      style={{ display: 'grid', gap: '6px' }}
                    >
                      {caps.map((cap) => (
                        <code
                          key={cap}
                          className="capability-pill"
                          style={{ display: 'block', padding: '4px 8px', wordBreak: 'break-all' }}
                        >
                          {cap}
                        </code>
                      ))}
                    </div>
                  ),
                  actionLabel: 'Close',
                });
              return (
                <button
                  type="button"
                  className="capabilities-cell-button"
                  title={fullText}
                  onClick={showCaps}
                >
                  <span className="capabilities-text">{fullText}</span>
                </button>
              );
            },
          },
          { key: 'lastActivityAt', label: 'Last activity', dateTime: true },
          {
            key: 'actions',
            label: '',
            sortable: false,
            search: false,
            render: (row: ConnectorItem) => (
              <div style={{ display: 'inline-flex', gap: '8px' }}>
                <button
                  type="button"
                  data-surface-id="connections:details"
                  onClick={() => setSelectedConnector(row)}
                >
                  Details
                </button>
                {row.revocable ? (
                  <button
                    type="button"
                    className="danger-button"
                    data-surface-id="connections:revoke"
                    onClick={() => void revokeSingle(row)}
                  >
                    Revoke
                  </button>
                ) : null}
              </div>
            ),
          },
        ]}
        emptyText="No connectors found."
        rowKey={(row) => row.id}
      />

      <ConnectorModal
        open={addingConnector}
        onClose={() => setAddingConnector(false)}
        onCreated={resource.refresh}
        workspaces={workspaces}
      />

      <ConnectionDetailModal
        connection={selectedLive}
        workspaces={workspaces}
        onClose={() => setSelectedConnector(null)}
        onChanged={resource.refresh}
      />

      {toast}
    </PageState>
  );
}
