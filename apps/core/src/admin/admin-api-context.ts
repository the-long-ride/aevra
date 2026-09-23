import { McpToolService } from '../../../../packages/mcp-tools/src/service.js';
import { SkillsService } from '../skills/skills-service.js';
import { ManifestService } from '../workspaces/manifest-service.js';
import { ApprovalService } from '../approvals/approval-service.js';
import type { CoreConfig } from '../config.js';
import { AdminServer } from './server.js';

export function createRuntimeApprovalService(
  approvalRepo: any,
  audit: any,
  config: CoreConfig,
  safeMode: boolean,
  sessions: any,
) {
  const approvals = new ApprovalService(approvalRepo, audit, {
    fastWaitMs: config.approvalFastWaitMs,
    lifetimeMs: config.approvalLifetimeMs,
    lifetimeByRiskMs: config.approvalLifetimeByRiskMs,
  });
  if (!safeMode) approvals.cancelForRestart();
  approvals.setSessionIdentityResolver((sessionId) => sessions.connectionIdentity(sessionId));
  approvals.setApprovedHandler((ticket) => {
    if (ticket.operation.family === 'workspace:select' && ticket.decisionScope === 'connection') {
      const profileId = String((ticket.payload as any)?.profileId ?? 'read-only');
      sessions.grantConnectionWorkspace(ticket.sessionId, ticket.workspaceId, profileId);
    }
  });
  return approvals;
}

export function buildAdminApiContext(input: {
  workspaces: any;
  approvals: any;
  permissions: any;
  sessions: any;
  profiles: any;
  bootstrap: any;
  processes: any;
  changes: any;
  audit: any;
  settings: any;
  exposureWiring: any;
  localFilesystem: any;
  oauth: any;
  connections: any;
  environment: any;
  vault: any;
  database: any;
  connectors: any;
  metrics: any;
  activity: any;
  keepAwake: any;
  browserPairing: any;
  browserPolicy: any;
  desktopPolicy: any;
  desktopAccess: any;
  desktopAppCatalog: any;
  mcpUpstreams: any;
  systemCapabilities: () => any;
  getMcpDiagnostics: () => any;
  isSafeMode: () => boolean;
  commandEvaluator?: (input: any) => Promise<any>;
}) {
  return {
    workspaces: input.workspaces,
    approvals: input.approvals,
    permissions: input.permissions,
    sessions: input.sessions,
    profiles: input.profiles,
    bootstrap: input.bootstrap,
    processes: input.processes,
    changes: input.changes,
    audit: input.audit,
    settings: input.settings,
    cloudflare: input.exposureWiring.cloudflare,
    exposure: input.exposureWiring,
    localFilesystem: input.localFilesystem,
    oauth: input.oauth,
    connections: input.connections,
    environment: input.environment,
    vault: input.vault,
    database: input.database,
    connectors: input.connectors,
    metrics: input.metrics,
    activity: input.activity,
    power: input.keepAwake,
    browser: input.browserPairing,
    browserPolicy: input.browserPolicy,
    desktopPolicy: input.desktopPolicy,
    desktopAccess: input.desktopAccess,
    desktopAppCatalog: input.desktopAppCatalog,
    mcpUpstreams: input.mcpUpstreams,
    systemCapabilities: input.systemCapabilities,
    mcpDiagnostics: input.getMcpDiagnostics,
    safeMode: input.isSafeMode,
    commandEvaluator: input.commandEvaluator,
  };
}

export function createCoreToolService(
  sessions: any,
  workspaces: any,
  workerGateway: any,
  reads: any,
  approvals: any,
  deps: any,
) {
  return new McpToolService(sessions, workspaces, workerGateway, reads, approvals, {
    operations: deps.operations,
    resumableOperations: deps.resumableOperations,
    controlPlans: deps.controlPlans,
    processes: deps.processes,
    changes: deps.changes,
    permissions: deps.permissions,
    approvals,
    skills: new SkillsService(),
    security: deps.security,
    audit: deps.audit,
    connectorBindings: deps.connectorBindings,
    metrics: deps.metrics,
    settings: deps.settings,
    desktopAccess: deps.desktopAccess,
    desktopAppCatalog: deps.desktopAppCatalog,
    systemCapabilities: deps.systemCapabilities,
    browserPolicy: deps.browserPolicy,
    manifests: new ManifestService(workspaces),
    upstreams: deps.upstreams ?? deps.mcpUpstreams,
  });
}

export function createRuntimeAdminServer(
  config: CoreConfig,
  opts: {
    bootstrap: any;
    credentialVerifier: any;
    controlSecret: string;
    staticDir: string;
    localTls?: any;
    exposureWiring: any;
    trustedAdminOrigins: string[];
    gatewayTrustSecret: string;
    api: any;
  },
  healthResolver: () => any,
): AdminServer {
  return new AdminServer(config.adminHost, config.adminPort, healthResolver, {
    bootstrap: opts.bootstrap,
    credentialVerifier: opts.credentialVerifier,
    controlSecret: opts.controlSecret,
    staticDir: opts.staticDir,
    ...(opts.localTls ? { tls: opts.localTls } : {}),
    advertisedHost: 'localhost',
    trustedOrigins: () => opts.exposureWiring?.trustedAdminOrigins() ?? opts.trustedAdminOrigins,
    gatewayTrustSecret: opts.gatewayTrustSecret,
    localHttpGatewayEnabled: () =>
      opts.exposureWiring?.currentConfig().provider === 'local' &&
      opts.exposureWiring.localProtocol() === 'http',
    api: opts.api,
  });
}
