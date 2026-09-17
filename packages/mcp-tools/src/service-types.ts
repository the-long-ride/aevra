import type { CapabilityRoot, SystemCapabilitySnapshot } from '../../protocol/src/index.js';
import type { WorkerOperation, WorkerResult } from '../../protocol/src/worker.js';
import type { ApprovalService } from '../../../apps/core/src/approvals/approval-service.js';
import type { AuditService } from '../../../apps/core/src/audit/audit-service.js';
import type { ChangeSetService } from '../../../apps/core/src/changes/change-service.js';
import type { OperationService } from '../../../apps/core/src/operations/operation-service.js';
import type { ReadVersionCache } from '../../../apps/core/src/operations/read-version-cache.js';
import type { ResumableOperationService } from '../../../apps/core/src/operations/resumable-operation-service.js';
import type { PermissionEngine } from '../../../apps/core/src/policy/permissions.js';
import type { ProcessService } from '../../../apps/core/src/processes/process-service.js';
import type { SecurityGuard } from '../../../apps/core/src/security/security-guard.js';
import type { SessionManager } from '../../../apps/core/src/sessions/session-manager.js';
import type { SkillsService } from '../../../apps/core/src/skills/skills-service.js';
import type { WorkspaceService } from '../../../apps/core/src/workspaces/workspace-service.js';
import type { UpstreamRegistryService } from './upstream-port.js';

export interface WorkerGateway {
  execute(input: {
    sessionId: string;
    workspaceId: string;
    roots: CapabilityRoot[];
    operation: WorkerOperation;
    expectedState?: Record<string, string>;
    executionMode?: 'sandbox' | 'host';
  }): Promise<WorkerResult>;
}

export interface MetricsSink {
  record(tool: string, durationMs: number): void;
}

export interface SettingsReader {
  get<T>(key: string, defaultValue: T): T;
}

export interface ManifestSummary {
  commands: Record<string, string>;
  protectedPathsSummary: { sensitive: number; secret: number };
  warning: string | null;
}

export interface McpToolDependencies {
  operations?: OperationService;
  resumableOperations?: ResumableOperationService;
  processes?: ProcessService;
  changes?: ChangeSetService;
  permissions?: PermissionEngine;
  approvals?: ApprovalService;
  skills?: SkillsService;
  security?: SecurityGuard;
  audit?: AuditService;
  connectorBindings?: (subject: string) => {
    workspaceId: string | null;
    profileCap: string | null;
  } | null;
  metrics?: MetricsSink;
  settings?: SettingsReader;
  systemCapabilities?: SystemCapabilitySnapshot;
  // Structural on purpose: mcp-tools must not depend on the core pairing
  // class for two accessors.
  browserPairing?: {
    epoch(): number;
    pairedExtensionId(): string | null;
  };
  // Structural for the same reason as browserPairing: mcp-tools must not
  // depend on a core class for one accessor.
  browserPolicy?: {
    snapshot(): {
      aevraPorts: number[];
      aevraOrigins: string[];
      loopbackClass: 'BLOCKED' | 'SENSITIVE' | 'NORMAL';
      blockedHosts: string[];
      sensitiveHosts: string[];
    };
  };
  // Structural for the same reason as browserPairing/browserPolicy: mcp-tools
  // must not depend on a core class for one accessor.
  manifests?: {
    summarize(hostRoot: string | null): ManifestSummary;
    // Serialisable form of the same rules, for operations the executor
    // re-classifies on the far side of the worker boundary.
    globsFor?(workspaceId: string): Array<{ glob: string; class: 'SENSITIVE' | 'SECRET' }>;
  };
  upstreams?: UpstreamRegistryService;
}

export type McpDependencies = McpToolDependencies;

export interface McpRuntimeContext {
  sessions: SessionManager;
  workspaces: WorkspaceService;
  workspaceId?: string;
  worker: WorkerGateway;
  reads: ReadVersionCache;
  approvals?: ApprovalService;
  deps: McpDependencies;
  oneTimeCapabilities: Set<string>;
  processStart: (sessionId: string, args: any) => Promise<any>;
  callInner: (sessionId: string, name: string, args: any) => Promise<any>;
  proxyOperation: (sessionId: string, operation: McpProxyOperation) => Promise<unknown>;
}

export type McpProxyOperation =
  | { kind: 'tool'; name: string; args: unknown }
  | { kind: 'resource'; uri: string }
  | { kind: 'prompt'; name: string; args: unknown };
