export interface AgentChangeRow {
  target: string;
  file: string;
  action: 'create' | 'update' | 'remove';
}
export interface AgentResultRow {
  target: string;
  ok: boolean;
  message?: string;
  error?: string;
}
export interface AgentRegistrationRow {
  target: string;
  scope: 'user' | 'workspace';
  workspaceId?: string;
  workspaceRoot?: string;
  credentialId?: string;
  transport: string;
  state?: string;
  config?: string;
  lastUsedAt?: string | number | null;
  // Set by core when the connector this registration issued no longer exists.
  connectorMissing?: boolean;
}
export interface DetectedRow {
  target: string;
  found: boolean;
  evidence: string;
  configPath: string;
}
export interface AgentApiResponse {
  dryRun?: boolean;
  registrations?: AgentRegistrationRow[];
  message?: string;
  notes?: string[];
  changes?: AgentChangeRow[];
  results?: AgentResultRow[];
}
export interface AgentTableRow {
  target: string;
  found: boolean;
  scope?: 'user' | 'workspace';
  workspaceName?: string;
  transport?: string;
  state?: string;
  lastUsedAt?: string | number | null;
  connectorMissing?: boolean;
}
export interface SummaryCommand {
  action: 'install' | 'uninstall';
  targets: string[];
  scope?: 'user' | 'workspace';
  workspace?: string;
  id?: string;
  dryRun: boolean;
}

const HEADERS = ['Agent', 'Found', 'Scope', 'Transport', 'State', 'Last used'];

function lastUsed(value: string | number | null | undefined): string {
  if (value === undefined) return '-';
  if (value === null) return 'never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'never' : date.toISOString().slice(0, 10);
}

function columns(rows: string[][]): string[] {
  const widths = HEADERS.map((_, col) => Math.max(...rows.map((row) => row[col]!.length)));
  return rows.map((row) =>
    row
      .map((cell, col) => cell.padEnd(widths[col]!))
      .join('  ')
      .trimEnd(),
  );
}

export function formatAgentTable(rows: AgentTableRow[]): string {
  const cells = rows.map((row) => {
    const connected = row.scope !== undefined;
    return [
      row.target,
      row.found ? 'yes' : 'no',
      !connected ? '-' : row.scope === 'user' ? 'global' : (row.workspaceName ?? 'workspace'),
      row.transport ?? '-',
      row.state ?? (connected ? 'installed' : 'not connected'),
      !connected ? '-' : row.connectorMissing ? 'missing' : lastUsed(row.lastUsedAt),
    ];
  });
  return columns([HEADERS, ...cells]).join('\n');
}

function baseName(root: string | undefined): string | undefined {
  return root
    ?.split(/[\\/]+/)
    .filter(Boolean)
    .pop();
}

export function buildAgentRows(
  detected: DetectedRow[],
  registrations: AgentRegistrationRow[],
  workspaceNames: Map<string, string>,
): AgentTableRow[] {
  const targets = [...detected.map((row) => row.target)];
  for (const reg of registrations) if (!targets.includes(reg.target)) targets.push(reg.target);
  return targets.flatMap((target) => {
    const found = detected.find((row) => row.target === target)?.found ?? false;
    const own = registrations.filter((reg) => reg.target === target);
    if (!own.length) return [{ target, found }];
    return own.map((reg) => ({
      target,
      found,
      scope: reg.scope,
      workspaceName:
        (reg.workspaceId ? workspaceNames.get(reg.workspaceId) : undefined) ??
        baseName(reg.workspaceRoot),
      transport: reg.transport,
      ...(reg.state ? { state: reg.state } : {}),
      lastUsedAt: reg.lastUsedAt ?? null,
      ...(reg.connectorMissing ? { connectorMissing: true } : {}),
    }));
  });
}

// Workspace connections whose folder is not a registered Aevra workspace can only be removed by
// their connection id (not secret). Other rows never show it.
export function formatOrphans(registrations: AgentRegistrationRow[]): string {
  const orphans = registrations.filter(
    (reg) => reg.scope === 'workspace' && !reg.workspaceId && reg.credentialId,
  );
  if (!orphans.length) return '';
  return [
    '',
    'Not in a registered workspace (remove with: aevra agent uninstall --id <id>):',
    ...orphans.map((reg) => `  ${reg.target}  ${reg.workspaceRoot ?? '-'}  ${reg.credentialId}`),
  ].join('\n');
}

export function formatDetectedList(found: DetectedRow[]): string {
  const width = Math.max(...found.map((row) => row.target.length));
  return [
    'Detected agents:',
    ...found.map(
      (row) =>
        `  ${row.target.padEnd(width)}  ${row.evidence === 'path' ? 'on PATH' : `config at ${row.configPath}`}`,
    ),
  ].join('\n');
}

function scopeLabel(command: SummaryCommand): string {
  if (command.id !== undefined) return `connection ${command.id}`;
  if (command.workspace) return `workspace ${command.workspace}`;
  if (command.action === 'uninstall' && !command.scope && command.targets.includes('all'))
    return 'all scopes';
  return 'global';
}

export function formatInstallSummary(response: AgentApiResponse, command: SummaryCommand): string {
  const results = response.results ?? [];
  const changes = response.changes ?? [];
  const width = Math.max(0, ...results.map((row) => row.target.length));
  const tense = command.dryRun ? 'would ' : '';
  const lines = [
    `Agent ${command.action} (${scopeLabel(command)})${command.dryRun ? ', dry run' : ''}`,
  ];
  for (const row of results) {
    const own = changes.filter((item) => row.target === 'all' || item.target === row.target);
    const detail = row.ok
      ? own.length
        ? own.map((item) => `${tense}${item.action} ${item.file}`).join('; ')
        : 'no change'
      : (row.error ?? 'failed');
    lines.push(`  ${row.ok ? 'ok   ' : 'error'}  ${row.target.padEnd(width)}  ${detail}`);
  }
  if (response.notes?.length) lines.push('Notes:', ...response.notes.map((note) => `  - ${note}`));
  if (command.dryRun) lines.push('Dry run: nothing was written.');
  else if (results.some((row) => row.ok)) lines.push('Restart or refresh the agent to apply.');
  return lines.join('\n');
}

// Registration records carry credential file paths and hashes; they never leave the machine
// through the CLI output.
export function redactRegistrations<T extends object>(response: T): T {
  const { registrations } = response as { registrations?: unknown };
  if (!Array.isArray(registrations)) return response;
  return {
    ...response,
    registrations: registrations.map((reg) => {
      const {
        credentialFile: _file,
        credentialHash: _hash,
        ...rest
      } = reg as Record<string, unknown>;
      return rest;
    }),
  };
}
