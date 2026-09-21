import { WorkspaceRepository } from '../../../packages/store/src/workspaces.js';
import { SessionRepository } from '../../../packages/store/src/sessions.js';
import { PermissionRepository } from '../../../packages/store/src/permissions.js';
import { ApprovalRepository } from '../../../packages/store/src/approvals.js';
import { OperationRepository } from '../../../packages/store/src/operations.js';
import { ChangeRepository } from '../../../packages/store/src/changes.js';
import { AuditRepository } from '../../../packages/store/src/audit.js';
import { ProcessRepository } from '../../../packages/store/src/processes.js';
import { ConnectorRepository } from '../../../packages/store/src/connectors.js';
import { OAuthRepository } from '../../../packages/store/src/oauth.js';
import { SettingsRepository } from '../../../packages/store/src/settings.js';
import { migratePermissionRules } from './policy/command-rule-migration.js';

export function createRuntimeRepositories(raw: any) {
  const permissionRepo = new PermissionRepository(raw);
  try {
    migratePermissionRules(permissionRepo);
  } catch {
    // Non-blocking in case database schema is pre-migration
  }
  return {
    settings: new SettingsRepository(raw),
    workspaceRepo: new WorkspaceRepository(raw),
    sessionRepo: new SessionRepository(raw),
    permissionRepo,
    approvalRepo: new ApprovalRepository(raw),
    operationRepo: new OperationRepository(raw),
    changeRepo: new ChangeRepository(raw),
    auditRepo: new AuditRepository(raw),
    processRepo: new ProcessRepository(raw),
    connectorRepo: new ConnectorRepository(raw),
    oauthRepo: new OAuthRepository(raw),
  };
}
