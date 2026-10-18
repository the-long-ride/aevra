import type { UpstreamSummary } from './McpUpstreamsSettings';

export type DiffKind = 'tool' | 'resource' | 'prompt';

const CATALOG_CHANGED_CODE = 'MCP_UPSTREAM_CATALOG_CHANGED';
export const CATALOG_CHANGED_MESSAGE =
  'The catalog changed after you opened the review. The list was refreshed - review it again.';

/** An enabled server whose catalog change is waiting for the owner. */
export function isPendingReview(row: UpstreamSummary): boolean {
  return row.enabled && row.state === 'needs-review';
}

/** A pending row that has a fetched catalog diff and fingerprint to accept. */
export function isReviewable(row: UpstreamSummary): boolean {
  return (
    isPendingReview(row) &&
    row.pendingCatalogDiff !== null &&
    row.pendingCatalogDiff !== undefined &&
    typeof row.pendingCatalogFingerprint === 'string' &&
    row.pendingCatalogFingerprint.length > 0
  );
}

/** Split a diff key at the first colon; the rest (which may hold colons) is the name. */
export function parseDiffKey(key: string): { kind: DiffKind; name: string } {
  const index = key.indexOf(':');
  if (index < 0) return { kind: 'tool', name: key };
  const head = key.slice(0, index);
  const kind: DiffKind = head === 'resource' || head === 'prompt' ? head : 'tool';
  return { kind, name: key.slice(index + 1) };
}

/**
 * True when accept failed because the catalog moved after review. The admin client
 * keeps only the message, so the stable message text is matched as well as the code.
 */
export function isCatalogChangedError(cause: unknown): boolean {
  if (typeof cause === 'object' && cause !== null) {
    if ((cause as { code?: unknown }).code === CATALOG_CHANGED_CODE) return true;
    const message = (cause as { message?: unknown }).message;
    return typeof message === 'string' && message.includes('catalog changed after review');
  }
  return false;
}
