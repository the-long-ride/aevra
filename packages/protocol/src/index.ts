export type AevraErrorCode =
  | 'CAPABILITY_REQUIRED'
  | 'SESSION_WORKSPACE_REQUIRED'
  | 'WORKSPACE_ESCAPE'
  | 'WRITE_CONFLICT'
  | 'MERGE_CONFLICT'
  | 'APPROVAL_PENDING'
  | 'APPROVAL_DENIED'
  | 'APPROVAL_TIMEOUT'
  | 'APPROVAL_CONTEXT_CHANGED'
  | 'EXECUTOR_UNAVAILABLE'
  | 'RECOVERY_REQUIRED'
  | 'EXECUTION_OUTCOME_UNKNOWN'
  | 'INVALID_REQUEST'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'VAULT_LOCKED'
  | 'SKILL_NOT_FOUND'
  | 'SKILL_PATH_ESCAPE'
  | 'SKILL_FILE_TOO_LARGE';
export type Capability =
  | 'files.read'
  | 'files.search'
  | 'git.read'
  | 'files.write'
  | 'files.delete'
  | 'commands.run'
  | 'git.commit'
  | 'git.push'
  | 'network';
export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type CommandEffect =
  | 'READ_ONLY'
  | 'BUILD_OUTPUT'
  | 'SOURCE_MUTATION'
  | 'REPOSITORY_STATE'
  | 'UNKNOWN';
export type ExecutionMode = 'sandbox' | 'host';
export type ProcessLifecycle = 'stop-with-aevra' | 'keep-running';
export type ManagedProcessState = 'running' | 'completed' | 'failed' | 'stopped' | 'unknown';
export interface CapabilityRoot {
  id: string;
  kind: 'workspace' | 'external';
  logicalPrefix: string;
  hostRoot: string;
  capabilities: Capability[];
  sensitivityPolicyId?: string;
}
export interface ResolvedCapabilityPath {
  rootId: string;
  logicalPath: string;
  hostPath: string;
  canonicalHostPath: string;
}
export interface NormalizedOperation {
  family: string;
  capability: Capability;
  risk: RiskTier;
  effect?: CommandEffect;
  resource?: string;
  argsHash: string;
}
export interface ConflictRange {
  baseStart: number;
  baseEnd: number;
}
export interface CommandInput {
  executable: string;
  args: string[];
  cwdLogical?: string;
  env: Record<string, string>;
  timeoutMs?: number;
}
export interface CommandResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}
export interface ManagedChild {
  processId: string;
  pid: number;
  startedAt: string;
}
export interface ManagedProcessStatus extends ManagedChild {
  lifecycle: ProcessLifecycle;
  state: ManagedProcessState;
  exitCode: number | null;
  signal: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  marker?: string;
  logPath?: string;
  resultPath?: string;
}
export interface NetworkPolicy {
  mode: 'deny-all' | 'allow-rules';
  destinations: Array<{ protocol: string; host: string; port: number }>;
  enforcement: 'backend' | 'proxy' | 'advisory';
}
export interface SandboxPrepareInput {
  workspaceId: string;
  roots: CapabilityRoot[];
  cachePolicy: 'shared' | 'workspace' | 'disabled';
}
export interface SandboxHandle {
  id: string;
  backend: 'docker' | 'podman';
}
export interface SandboxInspection {
  ready: boolean;
  image: string;
  networkPolicyApplied: boolean;
}
export interface ChangeSet {
  id: string;
  workspaceId: string;
  ownerSessionId: string;
  state: 'OPEN' | 'COMMITTED' | 'ROLLED_BACK' | 'RECOVERY_REQUIRED';
}
export interface MutationRecordInput {
  changeSetId: string;
  operationId: string;
  logicalPath: string;
  beforeHash?: string;
  afterHash?: string;
  snapshotPath?: string;
}
export interface RollbackOptions {
  force: boolean;
  skipPaths: string[];
}
export type RollbackResult = { kind: 'rolled-back' } | { kind: 'conflict'; paths: string[] };
export interface CloudflaredStatus {
  found: boolean;
  version?: string;
  path?: string;
}
export type CloudflareAuthMode = 'connector' | 'access';
export interface CloudflareSetupInput {
  accountId?: string;
  domain?: string;
  hostname?: string;
  tunnelId?: string;
  issuer?: string;
  audience?: string;
  authMode?: CloudflareAuthMode;
  ownership?: 'managed' | 'external';
}
export interface CloudflareSetupResult {
  authMode: CloudflareAuthMode;
  hostname: string;
  tunnelId: string;
  issuer?: string;
  audience?: string;
  ownership: 'managed' | 'external';
}
export interface ReachabilityResult {
  reachable: boolean;
  status?: number;
  message: string;
}
export interface Clock {
  now(): Date;
}
export type ToolResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: { code: AevraErrorCode; message: string; details?: Record<string, unknown> };
    };
