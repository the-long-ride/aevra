import { requestJson } from '../core/api.js';
import { escapeHtml } from '../core/dom.js';
import { localDateTime } from '../core/time.js';
import { mountDataTable } from '../components/data-table.js';
import { toast } from '../components/toast.js';

export async function renderAuditPage(container) {
  const render = async () => {
    const [verify, events] = await Promise.all([
      requestJson('/api/audit/verify'),
      requestJson('/api/audit/export?format=json'),
    ]);
    const rows = events
      .slice()
      .reverse()
      .map((item) => ({
        ...item.event,
        createdAt: item.createdAt,
        searchText: [
          item.event?.actor,
          item.event?.operation,
          item.event?.target,
        ]
          .filter(Boolean)
          .join(' '),
      }));
    container.innerHTML = `<section class="page-head">
      <div><h2>Audit</h2><p>Hash-chain integrity: <strong>${verify.valid ? 'valid' : `broken at ${escapeHtml(verify.brokenEventId)}`}</strong></p></div>
      <div class="actions"><a href="/api/audit/export?format=json" target="_blank"><button type="button">Export JSON</button></a><a href="/api/audit/export?format=jsonl" target="_blank"><button type="button">Export JSONL</button></a><button type="button" class="danger-button" id="clear-audit">Clear history</button></div>
    </section>
    <section class="panel"><div id="audit-table"></div></section>`;
    mountDataTable(container.querySelector('#audit-table'), {
      id: 'audit-admin',
      rows,
      pageSize: 25,
      searchPlaceholder: 'Filter actor, operation, or target…',
      defaultSort: { key: 'createdAt', dir: 'desc' },
      columns: [
        {
          key: 'createdAt',
          label: 'Time',
          render: (row) => escapeHtml(localDateTime(row.createdAt)),
          searchValue: (row) => row.searchText,
        },
        { key: 'actor', label: 'Actor' },
        {
          key: 'operation',
          label: 'Operation',
          render: (row) => `<code>${escapeHtml(row.operation ?? '—')}</code>`,
        },
        { key: 'target', label: 'Target' },
        { key: 'result', label: 'Result' },
      ],
      emptyText: 'No audit events.',
    });
    container.querySelector('#clear-audit').addEventListener('click', async () => {
      if (
        !confirm(
          'Permanently clear all audit event history? Aevra will keep the hash-chain checkpoint so future events remain verifiable.',
        )
      ) {
        return;
      }
      await requestJson('/api/audit', { method: 'DELETE' });
      toast('Audit history cleared', 'success');
      await render();
    });
  };
  await render();
}
