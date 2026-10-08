export type TokenUsageRange = '24h' | '7d' | '30d' | '90d' | 'all';

/** All token numbers are estimates (`estimator`), never the model's billed count. */
export interface TokenUsageTotals {
  calls: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  savedTokens: number;
  avgDurationMs: number;
}
export interface TokenUsageBucket extends TokenUsageTotals {
  /** ISO start of the hour (UTC) or of the host-local day. */
  start: string;
}
export interface TokenUsageToolTotals extends TokenUsageTotals {
  tool: string;
}
export interface TokenUsageConnectorTotals extends TokenUsageTotals {
  connector: string;
  label: string;
}
export interface TokenUsageReport {
  estimator: 'heuristic-v1';
  range: TokenUsageRange;
  granularity: 'hour' | 'day';
  totals: TokenUsageTotals;
  today: TokenUsageTotals;
  topToolToday: { tool: string; outputTokens: number } | null;
  series: TokenUsageBucket[];
  byTool: TokenUsageToolTotals[];
  byConnector: TokenUsageConnectorTotals[];
}

// Keep these unions identical to TOOL_GROUPS / RESULT_FORMATS in
// packages/mcp-tools/src/tool-groups.ts (a core route test pins the list).
export type ToolGroup =
  | 'files'
  | 'commands'
  | 'git'
  | 'changes'
  | 'skills'
  | 'browser'
  | 'desktop'
  | 'control'
  | 'upstream';
export type ResultFormat = 'both' | 'text' | 'structured';
export interface ConnectorProfile {
  toolGroups?: ToolGroup[];
  resultFormat?: ResultFormat;
}
export interface ConnectorProfileEntry {
  actor: string;
  label: string;
  kind: 'connector' | 'oauth' | 'client' | 'other';
  profile: ConnectorProfile;
}
export interface ConnectorProfilesResponse {
  groups: ToolGroup[];
  /** Estimated `tools/list` tokens per group; `core` is always on. */
  groupTokens: Record<'core' | ToolGroup, number>;
  entries: ConnectorProfileEntry[];
}
