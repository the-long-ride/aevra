import type { CapabilityRoot } from '../../protocol/src/index.js';
import type { WorkerOperation, WorkerResult } from '../../protocol/src/worker.js';
import type { ApprovalService } from '../../../apps/core/src/approvals/approval-service.js';
import type { ChangeSetService } from '../../../apps/core/src/changes/change-service.js';
import type { OperationService } from '../../../apps/core/src/operations/operation-service.js';
import type { ReadVersionCache } from '../../../apps/core/src/operations/read-version-cache.js';
import type { PermissionEngine } from '../../../apps/core/src/policy/permissions.js';
import type { ProcessService } from '../../../apps/core/src/processes/process-service.js';
import type { SessionManager } from '../../../apps/core/src/sessions/session-manager.js';
import type { SkillsService } from '../../../apps/core/src/skills/skills-service.js';
import type { WorkspaceService } from '../../../apps/core/src/workspaces/workspace-service.js';

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

export interface McpToolDependencies {
  operations?: OperationService;
  processes?: ProcessService;
  changes?: ChangeSetService;
  permissions?: PermissionEngine;
  approvals?: ApprovalService;
  skills?: SkillsService;
  connectorBindings?: (
    subject: string,
  ) => { workspaceId: string | null; profileCap: string | null } | null;
  metrics?: MetricsSink;
  settings?: SettingsReader;
}

export interface McpRuntimeContext {
  sessions: SessionManager;
  workspaces: WorkspaceService;
  worker: WorkerGateway;
  reads: ReadVersionCache;
  approvals?: ApprovalService;
  deps: McpToolDependencies;
  oneTimeCapabilities: Set<string>;
  callInner(sessionId: string, name: string, args?: any): Promise<any>;
  processStart(sessionId: string, args: any): Promise<any>;
}
