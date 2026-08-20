export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ApprovalState = 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED';

export interface OnboardingStatus {
  completed: boolean;
  completedSections: string[];
}

export interface ApprovalPresentation {
  title: string;
  action: string;
  target: string;
  preview?: string;
}

export interface ApprovalItem {
  id: string;
  state: ApprovalState;
  actor: string;
  sessionId?: string;
  risk: RiskTier;
  workspaceId?: string;
  expiresAt?: string;
  updatedAt?: string;
  operation: {
    family: string;
    capability: string;
  };
  payload?: Record<string, unknown>;
  presentation?: ApprovalPresentation;
}

export interface OauthRequestItem {
  id: string;
  clientId?: string;
  clientName?: string;
  pairingCode?: string;
  remoteIp?: string;
  requestedScopes?: string[];
  scopes?: string[];
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  hostRoot?: string;
  description?: string;
}

export interface RemoteSessionSummary {
  id: string;
  actor: string;
  yolo?: boolean;
  activeLeaseId?: string | null;
  lastActivityAt?: string;
  lease?: {
    workspaceId?: string | null;
  };
}

export interface ConnectorSummary {
  id: string;
  name: string;
  createdAt?: string;
  lastUsedAt?: string;
}

export interface CloudflareStatus {
  found?: boolean;
  version?: string;
  authenticated?: boolean;
  authenticationMessage?: string;
  hostname?: string;
  tunnelId?: string;
  ownership?: 'managed' | 'external';
  authMode?: 'connector' | 'access';
  issuer?: string;
  audience?: string;
}

export type McpActivityKind = 'tool' | 'rpc' | 'session';
export type McpActivityState = 'running' | 'success' | 'error';

export interface McpActivityEntry {
  id: string;
  startedAt: string;
  updatedAt: string;
  actor: string;
  sessionId: string;
  workspaceId?: string;
  kind: McpActivityKind;
  action: string;
  state: McpActivityState;
  durationMs?: number;
}

export interface McpDiagnosticSnapshot {
  state: 'listening' | 'stopped';
  startedAt: string | null;
  requestCount: number;
  initializeCount: number;
  toolCallCount: number;
  lastInboundAt: string | null;
  lastMethod: string | null;
  lastActor: string | null;
  lastSessionId: string | null;
  lastToolName: string | null;
  hint:
    | 'no-client-traffic'
    | 'traffic-no-initialize'
    | 'initialized-no-tools'
    | 'active'
    | 'stopped';
}

export interface RuntimeHealthStatus {
  version?: string;
  core?: string;
  worker?: string;
  mcp?: string;
  mcpDiagnostics?: McpDiagnosticSnapshot | null;
  tunnel?: string;
  tunnelReachable?: boolean;
  safeMode?: boolean;
}

export interface DashboardRuntimeSnapshot {
  status: RuntimeHealthStatus;
  uptimeSeconds: number;
  pending: {
    total: number;
  };
  stats: {
    sessions: number;
    workspaceLeases: number;
    processes: number;
    openChanges: number;
    toolCalls: number;
    avgToolLatencyMs: number | null;
    connectors: number;
  };
  metrics: Array<Record<string, unknown>>;
  activeConnections: Array<Record<string, unknown>>;
  connectors: ConnectorSummary[];
}
