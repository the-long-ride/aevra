import type { ChangeSetService } from '../../../apps/core/src/changes/change-service.js';
import type { OperationService } from '../../../apps/core/src/operations/operation-service.js';
import type { ProcessService } from '../../../apps/core/src/processes/process-service.js';
import type { PermissionEngine } from '../../../apps/core/src/policy/permissions.js';
import type { SessionManager } from '../../../apps/core/src/sessions/session-manager.js';
import type { WorkspaceService } from '../../../apps/core/src/workspaces/workspace-service.js';
import type { ApprovalService } from '../../../apps/core/src/approvals/approval-service.js';
import type { SkillsService } from '../../../apps/core/src/skills/skills-service.js';
import type { MetricsService } from '../../../apps/core/src/metrics.js';
import type { SettingsRepository } from '../../store/src/settings.js';
import type { AuditService } from '../../../apps/core/src/audit/audit-service.js';
import type { ReadVersionCache } from '../../../apps/core/src/operations/read-version-cache.js';
import type { WorkerGateway } from './service.js';

export interface McpDependencies {
  operations?: OperationService;
  processes?: ProcessService;
  changes?: ChangeSetService;
  permissions?: PermissionEngine;
  approvals?: ApprovalService;
  skills?: SkillsService;
  audit?: AuditService;
  connectorBindings?: (subject: string) => {
    workspaceId?: string;
    profileCap?: string;
    expiresAt?: string;
  } | null;
  metrics?: MetricsService;
  settings?: SettingsRepository;
}

export interface McpRuntimeContext {
  sessions: SessionManager;
  workspaces: WorkspaceService;
  worker: WorkerGateway;
  reads: ReadVersionCache;
  approvals?: ApprovalService;
  deps: McpDependencies;
  oneTimeCapabilities: Set<string>;
  processStart: (sessionId: string, args: any) => Promise<any>;
  callInner: (sessionId: string, name: string, args: any) => Promise<any>;
}
