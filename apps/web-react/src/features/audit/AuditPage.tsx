import { DataTable } from '../../components/DataTable';
import { useDialog } from '../../components/Dialog';
import { PageState } from '../../components/PageState';
import { useApiResource } from '../../hooks/use-api-resource';
import { requestJson } from '../../services/api-client';

interface AuditVerify {
  valid: boolean;
  brokenEventId?: string;
}

interface AuditExportItem {
  createdAt?: string;
  event: Record<string, unknown>;
}

interface AuditData {
  verify: AuditVerify;
  rows: Array<Record<string, unknown>>;
}

async function load(signal: AbortSignal): Promise<AuditData> {
  const [verify, events] = await Promise.all([
    requestJson<AuditVerify>('/api/audit/verify', { signal }),
    requestJson<AuditExportItem[]>('/api/audit/export?format=json', { signal }),
  ]);
  return {
    verify,
    rows: events
      .slice()
      .reverse()
      .map((item) => ({ ...item.event, createdAt: item.createdAt })),
  };
}

export function AuditPage() {
  const resource = useApiResource(load);
  const dialog = useDialog();
  const clear = async () => {
    if (
      !(await dialog.confirm({
        title: 'Clear audit history',
        message: 'Permanently clear all audit event history? Aevra keeps the hash-chain checkpoint.',
        confirmLabel: 'Clear history',
        confirmTone: 'danger',
      }))
    ) {
      return;
    }
    await requestJson('/api/audit', { method: 'DELETE' });
    await resource.refresh();
  };
  return (
    <PageState loading={resource.loading} error={resource.error}>
      <section className="page-head">
        <div>
          <h2>Audit</h2>
          <p>
            Hash-chain integrity:{' '}
            <strong>
              {resource.data?.verify.valid
                ? 'valid'
                : `broken at ${resource.data?.verify.brokenEventId ?? 'unknown'}`}
            </strong>
          </p>
        </div>
        <div className="actions">
          <a href="/api/audit/export?format=json" target="_blank" rel="noreferrer">
            <button type="button" data-surface-id="audit:export-json">
              Export JSON
            </button>
          </a>
          <a href="/api/audit/export?format=jsonl" target="_blank" rel="noreferrer">
            <button type="button" data-surface-id="audit:export-jsonl">
              Export JSONL
            </button>
          </a>
          <button
            type="button"
            className="danger-button"
            data-surface-id="audit:clear"
            onClick={() => void clear()}
          >
            Clear history
          </button>
        </div>
      </section>
      <section className="panel">
        <DataTable
          id="react-audit"
          rows={resource.data?.rows ?? []}
          pageSize={25}
          searchPlaceholder="Filter actor, operation, or target…"
          columns={[
            { key: 'createdAt', label: 'Time' },
            { key: 'actor', label: 'Actor' },
            { key: 'operation', label: 'Operation' },
            { key: 'target', label: 'Target' },
            { key: 'result', label: 'Result' },
          ]}
          emptyText="No audit events."
        />
      </section>
    </PageState>
  );
}
