export type { CapabilityRoot } from './index.js';
export type ParseStatus = 'complete' | 'partial' | 'unsupported' | 'invalid';
export type ScopeStatus = 'inside' | 'outside' | 'unknown';
export type Dialect = 'direct' | 'pwsh' | 'powershell' | 'cmd' | 'bash' | 'sh' | 'zsh';
export type YoloPolicyMode = 'workspace' | 'unrestricted';

export function normalizeYoloMode(value: unknown): YoloPolicyMode {
  return value === 'unrestricted' ? 'unrestricted' : 'workspace';
}

export interface CommandRequest {
  kind: 'argv' | 'script';
  executable?: string;
  argv?: string[];
  script?: string;
  shell?: Exclude<Dialect, 'direct'> | 'auto';
  cwdLogical?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  executionMode: 'host' | 'sandbox';
  networkDestinations?: string[];
}

export interface AnalysisContext {
  actor: string;
  sessionId: string;
  workspaceId: string;
  rootsRevision: string;
  platform: 'win32' | 'linux' | 'darwin';
  backendId: string;
  backendRevision: string;
  policyRevision: string;
  environmentFingerprint: string;
  resolverGeneration: string;
  workspaceRoot?: string;
  roots?: Array<{ id?: string; logicalPrefix: string; hostRoot?: string }>;
}

export interface Reason {
  code: string;
  nodeId?: string;
  span?: { start: number; end: number };
  message: string;
}

export interface ExecutableIdentity {
  logicalName: string;
  canonicalPath: string;
  launcher: 'native' | 'cmd-shim' | 'script';
  fingerprint: string;
  provenance: 'operator' | 'installed' | 'workspace' | 'unknown';
  backendId: string;
}

export interface CommandNode {
  id: string;
  dialect: Dialect;
  argv: string[];
  executable?: ExecutableIdentity;
  wrappers: Array<{ app: string; identity: ExecutableIdentity; mappingVersion: string }>;
  application: string;
  operation: string[];
  scriptName?: string;
  options: Array<{ name: string; value?: string; sourceIndex: number }>;
  forwardedArgv: string[];
  cwdCandidates: string[];
  canonicalCwdCandidates?: string[];
  modifiers: string[];
  targets: Array<{
    path: string;
    access: 'read' | 'write' | 'cwd';
    scope: ScopeStatus;
    canonicalPath?: string;
  }>;
  effect: string;
  risk: string;
  scope: ScopeStatus;
  reasons: Reason[];
  scriptFingerprint?: string;
}

export interface CommandAnalysis {
  version: 1;
  requestFingerprint: string;
  context: AnalysisContext;
  parseStatus: ParseStatus;
  scope: ScopeStatus;
  nodes: CommandNode[];
  edges: Array<{
    from: string;
    to: string;
    kind: 'sequence' | 'success' | 'failure' | 'pipe' | 'subshell';
  }>;
  reasons: Reason[];
  evidenceFingerprint: string;
}

export interface CommandRuleV2 {
  version: 2;
  application: string;
  operation: string[];
  scriptName?: string;
  allowedModifiers: string[];
  allowedOptions: Array<{ name: string; values?: string[] }>;
  positionalConstraint: 'exact' | 'workspace-paths';
  exactArgv?: string[];
  targetScope: 'workspace';
  backends: string[];
  dialects: Dialect[];
  executableFingerprint: string;
  wrapperFingerprints: string[];
  scriptFingerprint?: string;
}

export type CommandDecision =
  | { outcome: 'deny' | 'invalid'; reasons: Reason[]; analysis?: CommandAnalysis }
  | {
      outcome: 'approval';
      reasons: Reason[];
      analysis: CommandAnalysis;
      suggestedRules: CommandRuleV2[];
    }
  | { outcome: 'allow'; analysis: CommandAnalysis; ruleIds: string[] };

export interface AnalysisServices {
  parse?(
    request: CommandRequest,
    context: AnalysisContext,
  ): Promise<{
    status: ParseStatus;
    nodes: CommandNode[];
    edges: CommandAnalysis['edges'];
    reasons: Reason[];
  }>;
  resolveExecutable(
    name: string,
    cwd: string,
    context: AnalysisContext,
  ): Promise<ExecutableIdentity | null>;
  canonicalize(
    path: string,
    cwd: string,
    access: 'read' | 'write' | 'cwd',
    context: AnalysisContext,
  ): Promise<{ canonicalPath?: string; scope: ScopeStatus; reasons: Reason[] }>;
  canonicalizeCwd?(
    cwd: string,
    context: AnalysisContext,
  ): Promise<{ canonicalPath?: string; scope: ScopeStatus; reasons: Reason[] }>;
  readConfig(
    path: string,
    maxBytes: number,
    context: AnalysisContext,
  ): Promise<{ text: string; fingerprint: string } | null>;
}

export interface CommandPolicyInput {
  analysis: CommandAnalysis;
  selectedLegacyDecision?: { outcome: 'allow' | 'deny' | 'approval'; reason: string };
  rules: Array<{
    id: string;
    effect: 'allow' | 'deny';
    predicate: CommandRuleV2;
    scope: 'session' | 'workspace' | 'global';
    actor?: string;
    sessionId?: string;
    workspaceId?: string;
    expiresAt?: string;
  }>;
  authority: { valid: boolean; commandCapability: boolean; reasons: Reason[] };
  network: { outcome: 'allow' | 'deny' | 'approval'; reasons: Reason[] };
  yolo: { active: boolean; mode: 'workspace' | 'unrestricted' };
  criticalAlwaysConfirm: boolean;
  scriptTrust: 'not-applicable' | 'trusted' | 'unapproved' | 'changed';
  exactApproval?: {
    ticketId: string;
    requestFingerprint: string;
    evidenceFingerprint: string;
    authorityVerified: boolean;
    consumed: boolean;
  };
}

export interface PreparedCommand {
  id: string;
  expiresAt: string;
  context: AnalysisContext;
  requestFingerprint: string;
  evidenceFingerprint: string;
  executable: ExecutableIdentity;
  argv: string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  timeoutMs?: number;
}
