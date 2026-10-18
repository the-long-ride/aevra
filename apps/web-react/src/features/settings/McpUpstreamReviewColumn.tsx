import type { Column } from '../../components/DataTable';
import { isPendingReview } from './mcp-upstream-review';
import type { UpstreamSummary } from './McpUpstreamsSettings';

function McpWarningIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="workspace-action-icon"
    >
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function reviewColumn(onReview: (row: UpstreamSummary) => void): Column<UpstreamSummary> {
  return {
    key: 'review',
    label: '',
    sortable: false,
    search: false,
    value: (row) => (isPendingReview(row) ? 1 : 0),
    render: (row) =>
      isPendingReview(row) ? (
        <button
          type="button"
          className="mcp-upstream-review-button"
          aria-label={`Review catalog changes for ${row.name}`}
          title={'Catalog changed \u2014 review'}
          aria-haspopup="dialog"
          onClick={() => onReview(row)}
        >
          <McpWarningIcon />
        </button>
      ) : null,
  };
}

export function McpUpstreamReviewNotice({ rows }: { rows: UpstreamSummary[] }) {
  const count = rows.filter(isPendingReview).length;
  if (count === 0) return null;
  const subject = count === 1 ? '1 server needs' : `${count} servers need`;
  return (
    <p className="inline-result warning-text mcp-upstream-review-notice">
      {`${subject} review \u2014 click \u26A0 to see what changed.`}
    </p>
  );
}
