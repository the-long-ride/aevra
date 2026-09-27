import type { CoreConfig } from './config.js';
import { createRuntimeRepositories } from './runtime-repositories.js';
import { ConnectionAdminService } from './admin/connection-admin.js';
import { CapabilityProfileService } from './policy/capabilities.js';
import { SessionManager } from './sessions/session-manager.js';
import { ConnectionStateStore } from './sessions/connection-state.js';
import { ConnectionWorkspaceGrantService } from './sessions/connection-workspace-grants.js';
import { WorkspaceService } from './workspaces/workspace-service.js';
import { ConnectionRateLimiter } from './mcp/connection-rate-limit.js';
import { IpRateLimiter } from './mcp/rate-limit.js';

export function createRuntimeConnectionServices(
  config: CoreConfig,
  raw: Parameters<typeof createRuntimeRepositories>[0],
  {
    oauthRepo,
    processRepo,
    workspaceRepo,
    sessionRepo,
  }: Pick<
    ReturnType<typeof createRuntimeRepositories>,
    'oauthRepo' | 'processRepo' | 'workspaceRepo' | 'sessionRepo'
  >,
) {
  const connectionState = new ConnectionStateStore(oauthRepo);
  processRepo.markKeepRunningUncertain();
  const workspaces = new WorkspaceService(workspaceRepo);
  const profiles = new CapabilityProfileService(raw);
  const connectionLimiter = new ConnectionRateLimiter();
  const invalidBearerLimiter = new IpRateLimiter(30, 1);
  const sessions = new SessionManager(
    sessionRepo,
    profiles,
    config.leaseIdleMs,
    undefined,
    connectionState,
    config.connectionReconnectGraceMs,
  );
  const grantHandler = new ConnectionWorkspaceGrantService({
    db: raw,
    oauthRepo,
    workspaceRepo,
    sessionRepo,
    profiles,
    idleMs: config.leaseIdleMs,
    sessions,
  });
  const connections = new ConnectionAdminService(
    oauthRepo,
    sessions,
    Math.floor(config.oauthAccessTokenTtlMs / 1000),
    undefined,
    grantHandler,
    (connId) => connectionLimiter.clear(connId),
  );
  return { workspaces, profiles, connectionLimiter, invalidBearerLimiter, sessions, connections };
}
