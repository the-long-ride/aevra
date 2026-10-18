import type { ApprovalItem } from '@aevra/admin-contracts';
import { DataTable } from '../../components/DataTable';
import { useDialog } from '../../components/Dialog';
import { useToast } from '../../components/Toast';
import { clearApprovalHistory } from './requests-service';

// Rows the server keeps when history is cleared.
const KEPT_STATES = new Set(['PENDING', 'APPROVED', 'EXECUTING']);

export function RequestHistory({
  history,
  onCleared,
}: {
  history: ApprovalItem[];
  onCleared(): Promise<void>;
}) {
  const dialog = useDialog();
  const { toast, success, error } = useToast();

  const deletable = history.filter((item) => !KEPT_STATES.has(item.state)).length;

  const clearHistory = async () => {
    const confirmed = await dialog.confirm({
      title: 'Clear approval history?',
      message: `Permanently removes ${deletable} finished approvals, including requests that timed out. Pending requests and approved requests that have not run yet are kept. The audit log is not affected.`,
      confirmLabel: 'Clear history',
      confirmTone: 'danger',
    });
    if (!confirmed) return;
    try {
      const deleted = await clearApprovalHistory();
      success(`Cleared ${deleted} approvals`);
      await onCleared();
    } catch (cause) {
      error(cause);
    }
  };

  return (
    <>
      <DataTable
        id="react-request-history"
        rows={history}
        pageSize={10}
        density="compact"
        toolbarActions={
          <button
            type="button"
            className="danger-button"
            data-surface-id="requests:clear-history"
            disabled={deletable === 0}
            onClick={() => void clearHistory()}
          >
            Clear history
          </button>
        }
        filters={[
          { key: 'state', label: 'Status' },
          { key: 'risk', label: 'Risk' },
        ]}
        columns={[
          { key: 'actor', label: 'Actor' },
          { key: 'state', label: 'Status' },
          { key: 'risk', label: 'Risk' },
          {
            key: 'operation',
            label: 'Operation',
            value: (row) => row.operation.family,
            render: (row) => row.operation.family,
          },
        ]}
        emptyText="No approval history."
        rowKey={(row) => row.id}
      />
      {toast}
    </>
  );
}
