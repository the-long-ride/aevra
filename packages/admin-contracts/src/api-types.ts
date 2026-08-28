import type { SystemCapabilitySnapshot } from '../../protocol/src/index.js';
export type { SystemCapabilitySnapshot } from '../../protocol/src/index.js';

export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ApprovalState = 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED';

export type ExposureProvider = 'local' | 'direct' | 'cloudflare' | 'ngrok' | 'external';
export type LocalProtocol = 'https' | 'http';

export interface ExposureConfig {
  provider: ExposureProvider;
  localProtocol?: LocalProtocol;
  publicUrl?: string;
  adminPublicUrl?: string;
  trustedAdminOrigins?: string[];
  direct?: { host: string };
  cloudflare?: {
    tunnelId?: string;
    hostname?: string;
    ownership: 'managed' | 'external';
    authMode: 'oauth' | 'access';
    issuer?: string;
    audience?: string;
  };
  ngrok?: { ownership: 'managed' | 'external'; domainMode?: 'automatic' | 'stable' };
}

export interface ExposureStatus {
  provider: ExposureProvider;
  state: 'stopped' | 'ready' | 'error' | string;
  localGatewayUrl?: string;
  publicUrl?: string;
  adminPublicUrl?: string;
  trustedAdminOrigins?: string[];
  message?: string;
  restartRequired?: boolean;
  checkedAt?: string;
  config?: ExposureConfig;
  oauth?: {
    issuer: string;
    resource: string;
  };
  health?: {
    providerProcess?: string;
    gateway?: string;
    publicHttps?: string;
    admin?: string;
    mcp?: string;
    oauth?: string;
    tls?: string;
  };
  tunnelHealth?: {
    reachable: boolean | null;
    checkedAt: string | null;
    message: string | null;
  };
}

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
  authType?: 'OAuth' | 'Bearer connector';
  createdAt?: string;
  lastUsedAt?: string;
  revocable?: boolean;
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
  input?: string;
  output?: string;
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
    'no-client-traffic' | 'traffic-no-initialize' | 'initialized-no-tools' | 'active' | 'stopped';
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

export type KeepAwakeMode = 'off' | 'remote-connections' | 'managed-processes' | 'always';

export interface KeepAwakeStatus {
  mode: KeepAwakeMode;
  active: boolean;
  supported: boolean;
  platform: string;
  reason: string;
  remoteConnections: number;
  managedProcesses: number;
  message?: string;
}

export interface TransportValidationEndpoint {
  url: string;
  protocol: LocalProtocol;
  encrypted: boolean;
  loopback: boolean;
}

export interface TransportValidationSnapshot {
  state: 'secure' | 'local-http' | 'action-required' | 'invalid';
  summary: string;
  gateway: TransportValidationEndpoint;
  admin: TransportValidationEndpoint;
  mcp: TransportValidationEndpoint;
  public: {
    url?: string;
    protocol: 'https' | null;
    encrypted: boolean | null;
  };
  issues: string[];
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
  power?: KeepAwakeStatus | null;
  system: SystemCapabilitySnapshot;
  transport: TransportValidationSnapshot;
  metrics: Array<Record<string, unknown>>;
  activeConnections: Array<Record<string, unknown>>;
  connectors: ConnectorSummary[];
}
