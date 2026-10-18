import type { McpCommandDependencies } from './mcp-command.js';
import { formatDiff, reviewHint, type McpReviewRow } from './mcp-review-format.js';

const CATALOG_CHANGED_CODE = 'MCP_UPSTREAM_CATALOG_CHANGED';

interface Failure {
  code?: string;
  message: string;
}
async function readFailure(response: {
  status: number;
  json(): Promise<unknown>;
}): Promise<Failure> {
  try {
    const value = (await response.json()) as { error?: { code?: string; message?: string } };
    return { code: value.error?.code, message: String(value.error?.message ?? response.status) };
  } catch {
    return { message: String(response.status) };
  }
}

async function findRow<Config>(
  config: Config,
  id: string,
  deps: McpCommandDependencies<Config>,
): Promise<McpReviewRow | undefined> {
  const response = await deps.api(config, '/api/mcp/upstreams');
  if (!response.ok) throw new Error((await readFailure(response)).message);
  const value = (await response.json()) as { upstreams?: McpReviewRow[] };
  return (value.upstreams ?? []).find((row) => row.id === id);
}

/** isReviewable is enabled-only (list marker); review/accept also serve disabled servers. */
function hasCatalog(row: McpReviewRow): boolean {
  return row.pendingCatalogDiff != null && row.pendingCatalogFingerprint != null;
}

/** A disabled server cannot be tested, so the hint says to enable it first. */
function blockedHint(row: McpReviewRow): string {
  if (row.enabled !== false) return reviewHint(row);
  return `[aevra] ${row.name} is blocked pending review and disabled. Run: aevra mcp enable ${row.id}, then aevra mcp test ${row.id}`;
}

function showDiff<Config>(row: McpReviewRow, deps: McpCommandDependencies<Config>): void {
  deps.log(`[aevra] ${row.name} changed its catalog:`);
  for (const line of formatDiff(row)) deps.log(line);
}

/**
 * Shows what a pending server changed. Read-only: nothing is sent to the server. Unlike the list
 * marker, review and accept work for disabled servers too: acknowledge ignores enabled.
 */
export async function runMcpReview<Config>(
  config: Config,
  id: string,
  deps: McpCommandDependencies<Config>,
): Promise<number> {
  const row = await findRow(config, id, deps);
  if (!row) {
    deps.error(`[aevra] No MCP server ${id}`);
    return 1;
  }
  if (row.state !== 'needs-review') {
    deps.log(`[aevra] ${row.name} has no pending catalog change`);
    return 0;
  }
  if (!hasCatalog(row)) {
    deps.log(blockedHint(row));
    return 0;
  }
  showDiff(row, deps);
  deps.log(`Run: aevra mcp accept ${row.id} --yes`);
  return 0;
}

/** Accepts the catalog the user was shown, by sending its pending fingerprint back. */
export async function runMcpAccept<Config>(
  config: Config,
  id: string,
  yes: boolean,
  deps: McpCommandDependencies<Config>,
): Promise<number> {
  const row = await findRow(config, id, deps);
  if (!row) {
    deps.error(`[aevra] No MCP server ${id}`);
    return 1;
  }
  if (row.state !== 'needs-review') {
    deps.error(`[aevra] ${row.name} has no pending catalog change`);
    return 1;
  }
  if (!hasCatalog(row)) {
    deps.error(blockedHint(row));
    return 1;
  }
  showDiff(row, deps);
  if (!yes) {
    deps.error('Re-run with --yes to accept');
    return 1;
  }
  const response = await deps.api(
    config,
    `/api/mcp/upstreams/${encodeURIComponent(row.id)}/acknowledge`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedFingerprint: row.pendingCatalogFingerprint }),
    },
  );
  if (!response.ok) {
    const failure = await readFailure(response);
    if (response.status === 409 && failure.code === CATALOG_CHANGED_CODE) {
      deps.error(`[aevra] The catalog changed again; run aevra mcp review ${row.id}`);
      return 1;
    }
    throw new Error(failure.message);
  }
  deps.log(`[aevra] Accepted catalog for ${row.name}; its tools are served again`);
  return 0;
}
