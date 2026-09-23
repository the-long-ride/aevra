import type { McpActivityEntry, WorkspaceSummary } from '@aevra/admin-contracts';
import type { DialogApi } from '../../components/Dialog';
import { ActivityDetailBody } from './ActivityDetailBody';

export function clientLabel(actor: string): string {
  return actor.replace(/^(oauth:|connector:)/, '') || actor;
}

export interface ConnectorGroup {
  connector: string;
  entries: McpActivityEntry[];
}

export function groupEntriesByConnector(entries: McpActivityEntry[]): ConnectorGroup[] {
  const map = new Map<string, McpActivityEntry[]>();
  for (const entry of entries) {
    const connector = clientLabel(entry.actor) || 'Unknown';
    const list = map.get(connector);
    if (list) {
      list.push(entry);
    } else {
      map.set(connector, [entry]);
    }
  }
  return Array.from(map.entries()).map(([connector, groupEntries]) => ({
    connector,
    entries: groupEntries,
  }));
}

export function showMcpActivityDetails(
  dialog: DialogApi,
  entry: McpActivityEntry,
  workspaces: WorkspaceSummary[] = [],
): Promise<void> {
  const workspaceNames = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));
  const workspaceLabel = entry.workspaceId
    ? (workspaceNames.get(entry.workspaceId) ?? entry.workspaceId)
    : '—';

  return dialog.message({
    title: 'MCP activity details',
    actionLabel: 'Close',
    size: 'wide',
    message: (
      <ActivityDetailBody
        entry={entry}
        clientName={clientLabel(entry.actor)}
        workspaceLabel={workspaceLabel}
      />
    ),
  });
}

export interface TooltipState {
  x: number;
  y: number;
  timestamp: number;
  active: number;
  pinned: boolean;
}

export function getAnchorCoords(target: SVGElement, clientX?: number, clientY?: number) {
  const rect =
    typeof target.getBoundingClientRect === 'function' ? target.getBoundingClientRect() : null;
  if (rect && (rect.width > 0 || rect.left > 0 || rect.top > 0)) {
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top),
    };
  }
  return {
    x: clientX ?? 0,
    y: clientY ?? 0,
  };
}
