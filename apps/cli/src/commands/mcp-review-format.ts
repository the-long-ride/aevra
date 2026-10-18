export interface McpReviewRow {
  id: string;
  name: string;
  state: string;
  /** Absent from servers that predate enable/disable, which are all enabled. */
  enabled?: boolean;
  pendingCatalogDiff?: { added: string[]; removed: string[]; changed: string[] } | null;
  pendingCatalogFingerprint?: string | null;
}

/** An enabled server whose catalog changed and is not served until reviewed. */
export function isPendingReview(row: McpReviewRow): boolean {
  return row.enabled !== false && row.state === 'needs-review';
}

/** A pending server for which Aevra holds a diff and fingerprint the user can accept. */
export function isReviewable(row: McpReviewRow): boolean {
  return (
    isPendingReview(row) && row.pendingCatalogDiff != null && row.pendingCatalogFingerprint != null
  );
}

export function reviewHint(row: McpReviewRow): string {
  const diff = row.pendingCatalogDiff;
  if (isReviewable(row) && diff) {
    return `[aevra] ${row.name} changed its catalog (+${diff.added.length} added, -${diff.removed.length} removed, ~${diff.changed.length} changed). Run: aevra mcp review ${row.id}`;
  }
  return `[aevra] ${row.name} is blocked pending review. Run: aevra mcp test ${row.id}`;
}

/** Diff keys are `<kind>:<name>`; the name may itself contain colons. */
function formatKey(key: string): string {
  const index = key.indexOf(':');
  return index < 0 ? key : `${key.slice(0, index)} ${key.slice(index + 1)}`;
}

export function formatDiff(row: McpReviewRow): string[] {
  const diff = row.pendingCatalogDiff;
  if (!diff) return [];
  const lines: string[] = [];
  for (const [label, keys] of [
    ['Added:', diff.added],
    ['Removed:', diff.removed],
    ['Changed:', diff.changed],
  ] as const) {
    if (!keys.length) continue;
    lines.push(label, ...keys.map((key) => `  ${formatKey(key)}`));
  }
  if (row.pendingCatalogFingerprint) {
    lines.push(`Fingerprint: ${row.pendingCatalogFingerprint.slice(0, 12)}`);
  }
  return lines;
}
