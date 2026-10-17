import { ManagementModal } from '../../components/ManagementModal';
import { isPendingReview, isReviewable, parseDiffKey } from './mcp-upstream-review';
import { McpUpstreamToolDetails } from './McpUpstreamToolDetails';
import type { UpstreamSummary } from './McpUpstreamsSettings';

function DiffSection({
  title,
  keys,
  row,
  expandable,
}: {
  title: string;
  keys: string[];
  row: UpstreamSummary;
  expandable: boolean;
}) {
  if (keys.length === 0) return null;
  return (
    <section className="mcp-upstream-review-section">
      <h3>
        {title} ({keys.length})
      </h3>
      <ul className="mcp-upstream-hints">
        {keys.map((key) => {
          const { kind, name } = parseDiffKey(key);
          const tool =
            expandable && kind === 'tool' ? row.tools?.find((t) => t.name === name) : undefined;
          return (
            <li key={key}>
              {tool ? <McpUpstreamToolDetails tool={tool} /> : <strong>{name}</strong>}
              <span>{kind}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function McpUpstreamReviewModal({
  row,
  busy,
  onAccept,
  onTest,
  onClose,
}: {
  row: UpstreamSummary;
  busy: boolean;
  onAccept(fingerprint: string): void;
  onTest(): void;
  onClose(): void;
}) {
  const diff = row.pendingCatalogDiff;
  const fingerprint = row.pendingCatalogFingerprint;
  const reviewable = isReviewable(row) && diff && fingerprint;
  const pending = isPendingReview(row);
  return (
    <ManagementModal open title={`Review changes \u2014 ${row.name}`} onClose={onClose}>
      <div className="mcp-upstream-hints-content">
        {pending ? (
          <p className="warning-text">
            This server changed its catalog. Its tools are not served to the AI until you accept the
            change.
          </p>
        ) : (
          <p className="section-note">This server no longer needs review.</p>
        )}
        {reviewable ? (
          <>
            <p className="section-note">
              {
                'Pending catalog \u2014 these tool instructions have not been acknowledged. Viewing them does not accept the catalog change.'
              }
            </p>
            <DiffSection title="Added" keys={diff.added} row={row} expandable />
            <DiffSection title="Removed" keys={diff.removed} row={row} expandable={false} />
            <DiffSection title="Changed" keys={diff.changed} row={row} expandable />
          </>
        ) : pending ? (
          <p className="section-note">
            Aevra blocked a request to an entry outside the reviewed catalog. Press Test to fetch
            the server&apos;s current catalog, then review it here.
          </p>
        ) : null}
      </div>
      <footer className="modal-foot">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        {reviewable ? (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => onAccept(fingerprint)}
          >
            Accept changes
          </button>
        ) : pending ? (
          <button type="button" className="primary" disabled={busy} onClick={onTest}>
            Test now
          </button>
        ) : null}
      </footer>
    </ManagementModal>
  );
}
