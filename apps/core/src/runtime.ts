import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CoreConfig } from './config.js';
import { AevraDatabase } from '../../../packages/store/src/database.js';
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
import { SkillsService } from './skills/skills-service.js';
import { SecurityGuard } from './security/security-guard.js';
import { IpRateLimiter } from './mcp/rate-limit.js';
import { createConnectorAdmission } from './mcp/connector-admission.js';
import { McpActivityLog } from './mcp/activity-log.js';
import { AEVRA_VERSION } from './version.js';
import { MetricsService } from './metrics.js';
import { SettingsRepository } from '../../../packages/store/src/settings.js';
import { AdminServer } from './admin/server.js';
import { ConnectionAdminService } from './admin/connection-admin.js';
import { buildRuntimeHealth } from './admin/runtime-health.js';
import { McpIngressServer } from './mcp/server.js';
import { AdminBootstrapService, ensureLocalControlSecret } from './admin/bootstrap.js';
import { LocalFilesystemService } from './admin/local-filesystem.js';
import type { WorkerClient } from '../../../packages/ipc/src/client.js';
import { CapabilityProfileService } from './policy/capabilities.js';
import { SessionManager } from './sessions/session-manager.js';
import { ConnectionStateStore } from './sessions/connection-state.js';
import { WorkspaceService } from './workspaces/workspace-service.js';
import { ReadVersionCache } from './operations/read-version-cache.js';
import { ResumableOperationService } from './operations/resumable-operation-service.js';
import { AuditService } from './audit/audit-service.js';
import { ApprovalService } from './approvals/approval-service.js';
import { PermissionEngine } from './policy/permissions.js';
import { OperationService } from './operations/operation-service.js';
import { ChangeSetService } from './changes/change-service.js';
import { ProcessService } from './processes/process-service.js';
import { McpToolService } from '../../../packages/mcp-tools/src/service.js';
import {
  closeRuntimeResource,
  createRuntimeWorkerManager,
  resolveRuntimeSystemCapabilities,
  resolveRuntimeTls,
  runtimeWorkerGateway,
} from './runtime-support.js';
import { SessionSkillAccessGate } from '../../../packages/mcp-tools/src/skill-access-gate.js';
import { BackupService } from './backup/backup-service.js';
import { ConfigExportService } from './config/export-service.js';
import { EncryptedVault } from '../../../packages/secrets/src/vault.js';
import { CommandSecretStore } from '../../../packages/secrets/src/platform.js';
import { EnvironmentService } from './secrets/environment-service.js';
import type { CoreRuntime, RuntimeDependencies } from './runtime-types.js';
import { RuntimeExposureWiring } from './exposure/runtime-wiring.js';
import type { KeepAwakeService } from './power/keep-awake-service.js';
import { createRuntimeKeepAwakeService } from './power/runtime-keep-awake.js';
export type { CoreRuntime, RuntimeDependencies } from './runtime-types.js';
export async function createCoreRuntime(
  config: CoreConfig,
  deps: RuntimeDependencies = {},
): Promise<CoreRuntime> {
  let db: AevraDatabase | undefined,
    worker: WorkerClient | undefined,
    admin: AdminServer | undefined,
    mcp: McpIngressServer | undefined,
    exposureWiring: RuntimeExposureWiring | undefined,
    keepAwake: KeepAwakeService | undefined;
  let safeMode = false,
    started = false;
  const wm = createRuntimeWorkerManager(config, deps);
  const cleanup = async () => {
    if (keepAwake) await closeRuntimeResource(() => keepAwake!.close());
    keepAwake = undefined;
    if (exposureWiring) await closeRuntimeResource(() => exposureWiring!.close());
    exposureWiring = undefined;
    if (mcp) await closeRuntimeResource(() => mcp!.close());
    mcp = undefined;
    if (admin) await closeRuntimeResource(() => admin!.close());
    admin = undefined;
    if (worker) await closeRuntimeResource(() => wm.close());
    worker = undefined;
    try {
      db?.close();
    } catch {}
    db = undefined;
    started = false;
  };
  return {
    get adminUrl() {
      return admin ? admin.url() : `https://localhost:${config.adminPort}`;
    },
    get mcpUrl() {
      return mcp ? mcp.url() : `https://localhost:${config.mcpPort}`;
    },
    get gatewayUrl() {
      return exposureWiring?.gatewayUrl() ?? `https://localhost:${config.publicPort}`;
    },
    get publicUrl() {
      return exposureWiring?.publicUrl();
    },
    async start() {
      if (started) return;
      try {
        await mkdir(config.stateDir, { recursive: true, mode: 0o700 });
        await mkdir(config.recoveryDir, { recursive: true, mode: 0o700 });
        const systemCapabilities = await resolveRuntimeSystemCapabilities(deps);
        const tls = await resolveRuntimeTls(config, deps);
        const adminCredentialVerifier = await config.createAdminCredentialVerifier();
        db = (deps.databaseOpen ?? AevraDatabase.open)(config.databasePath);
        safeMode = !db.integrityCheck().ok;
        const raw = db.raw(),
          settings = new SettingsRepository(raw),
          workspaceRepo = new WorkspaceRepository(raw),
          sessionRepo = new SessionRepository(raw),
          permissionRepo = new PermissionRepository(raw),
          approvalRepo = new ApprovalRepository(raw),
          operationRepo = new OperationRepository(raw),
          changeRepo = new ChangeRepository(raw),
          auditRepo = new AuditRepository(raw),
          processRepo = new ProcessRepository(raw),
          connectorRepo = new ConnectorRepository(raw),
          oauthRepo = new OAuthRepository(raw);
        const connectorBindings = (subject: string) => connectorRepo.getBindings(subject);
        const connectionState = new ConnectionStateStore(oauthRepo);
        processRepo.markKeepRunningUncertain();
        const workspaces = new WorkspaceService(workspaceRepo),
          profiles = new CapabilityProfileService(raw),
          sessions = new SessionManager(
            sessionRepo,
            profiles,
            config.leaseIdleMs,
            undefined,
            connectionState,
            config.connectionReconnectGraceMs,
          ),
          connections = new ConnectionAdminService(
            oauthRepo,
            sessions,
            Math.floor(config.oauthAccessTokenTtlMs / 1000),
          ),
          audit = new AuditService(auditRepo),
          permissions = new PermissionEngine(permissionRepo),
          reads = new ReadVersionCache(),
          security = new SecurityGuard(sessions, workspaces);
        operationRepo.setConnectionResolver(
          (sessionId) => sessions.connectionIdentity(sessionId)?.connectionId,
        );
        const resumableOperations = new ResumableOperationService(operationRepo, sessions);
        sessions.invalidateForRestart();
        oauthRepo.invalidateEphemeralForRestart();
        if (!safeMode) worker = await wm.start();
        const workerGateway = runtimeWorkerGateway(wm, safeMode);
        const changes = new ChangeSetService(
            changeRepo,
            operationRepo,
            workspaces,
            workerGateway,
            config.recoveryDir,
          ),
          operations = new OperationService(
            sessions,
            workspaces,
            workerGateway,
            operationRepo,
            audit,
            reads,
          ),
          processes = new ProcessService(sessions, workspaces, workerGateway, processRepo);
        keepAwake = createRuntimeKeepAwakeService(
          settings,
          connections,
          processes,
          deps.sleepInhibitor,
        );
        operations.attachChangeService(changes);
        operations.setCommandEffectResolver((family, defaultEffect) => {
          const overrides = settings.get<Record<string, string>>('command.family.overrides', {});
          const value = overrides[family];
          return [
            'READ_ONLY',
            'BUILD_OUTPUT',
            'SOURCE_MUTATION',
            'REPOSITORY_STATE',
            'UNKNOWN',
          ].includes(value)
            ? (value as any)
            : defaultEffect;
        });
        operations.setExecutionSettingsResolver(() =>
          settings.get('execution.settings', { sandboxBackend: 'auto', cachePolicy: 'workspace' }),
        );
        sessions.setSwitchDrainHandler((sessionId, _old, _next, timeoutMs) =>
          operations.drainSession(
            sessionId,
            timeoutMs ?? settings.get<number>('workspace.drain.defaultMs', 60_000),
          ),
        );
        if (!safeMode) await changes.reconcileIncompleteOperations();
        const approvals = new ApprovalService(approvalRepo, audit, {
          fastWaitMs: config.approvalFastWaitMs,
          lifetimeMs: config.approvalLifetimeMs,
          lifetimeByRiskMs: config.approvalLifetimeByRiskMs,
        });
        if (!safeMode) approvals.cancelForRestart();
        approvals.setSessionIdentityResolver((sessionId) => sessions.connectionIdentity(sessionId));
        approvals.setApprovedHandler((ticket) => {
          if (ticket.operation.family === 'workspace:select')
            sessions.grantConnectionWorkspace(ticket.sessionId, ticket.workspaceId, 'read-only');
        });
        const metrics = new MetricsService();
        const activity = new McpActivityLog();
        const tools = new McpToolService(sessions, workspaces, workerGateway, reads, approvals, {
          operations,
          resumableOperations,
          processes,
          changes,
          permissions,
          approvals,
          skills: new SkillsService(),
          security,
          audit,
          connectorBindings,
          metrics,
          settings,
          systemCapabilities,
        });
        const remoteTools = new SessionSkillAccessGate(tools, sessions, approvals);
        const bootstrap = new AdminBootstrapService(raw);
        await bootstrap.revokeAll();
        const controlSecret = ensureLocalControlSecret(config.stateDir);
        const localFilesystem = new LocalFilesystemService();
        const gatewayTrustSecret = randomBytes(32).toString('base64url');
        exposureWiring = new RuntimeExposureWiring(
          config,
          settings,
          oauthRepo,
          tls,
          deps.cloudflare,
          gatewayTrustSecret,
        );
        const localTls = tls.serverOptions;
        const vault = new EncryptedVault(path.join(config.stateDir, 'secrets.vault')),
          platformSecrets = new CommandSecretStore(process.platform),
          secretStore = (await platformSecrets.probe()) ? platformSecrets : vault,
          environment = new EnvironmentService(raw, secretStore),
          configExport = new ConfigExportService(raw),
          backup = new BackupService(db, path.join(config.stateDir, 'backups'));
        const staticDir = fileURLToPath(new URL('../../web', import.meta.url));
        const databaseAdmin = {
          configExport: (portable: boolean) => configExport.export(portable),
          configPreview: (v: any) => configExport.previewImport(v),
          backup: () => backup.create('daily'),
        };
        const oauth = exposureWiring.oauth;
        admin = new AdminServer(
          config.adminHost,
          config.adminPort,
          () =>
            buildRuntimeHealth({
              version: AEVRA_VERSION,
              workerRunning: Boolean(worker),
              mcpRunning: Boolean(mcp),
              mcpDiagnostics: mcp?.diagnosticsSnapshot() ?? null,
              exposure: exposureWiring?.status() ?? null,
              safeMode,
              connectorFailedAttempts: connectorLimiter.totalFailures(),
            }),
          {
            bootstrap,
            credentialVerifier: adminCredentialVerifier,
            controlSecret,
            staticDir,
            ...(localTls ? { tls: localTls } : {}),
            advertisedHost: 'localhost',
            trustedOrigins: () =>
              exposureWiring?.trustedAdminOrigins() ?? config.trustedAdminOrigins,
            gatewayTrustSecret,
            localHttpGatewayEnabled: () =>
              exposureWiring?.currentConfig().provider === 'local' &&
              exposureWiring.localProtocol() === 'http',
            api: {
              workspaces,
              approvals,
              permissions: permissionRepo,
              sessions,
              profiles,
              bootstrap,
              processes,
              changes,
              audit,
              settings,
              cloudflare: exposureWiring.cloudflare,
              exposure: exposureWiring,
              localFilesystem,
              oauth,
              connections,
              environment,
              vault,
              database: databaseAdmin,
              connectors: connectorRepo,
              metrics,
              activity,
              power: keepAwake,
              systemCapabilities: () => systemCapabilities,
              mcpDiagnostics: () => mcp?.diagnosticsSnapshot() ?? null,
              safeMode: () => safeMode,
            },
          },
        );
        const verifier = exposureWiring.verifier;
        const connectorLimiter = new IpRateLimiter(30, 1);
        const connectorsAdmission = createConnectorAdmission(connectorRepo, connectorLimiter);
        mcp = new McpIngressServer(
          config.mcpHost,
          config.mcpPort,
          verifier,
          undefined,
          () => safeMode,
          { sessions, service: remoteTools },
          connectorsAdmission,
          {
            ...(localTls ? { tls: localTls } : {}),
            advertisedHost: 'localhost',
            plainMcpEnabled: true,
            oauth,
            activity,
          },
        );
        await admin.start();
        await mcp.start();
        await exposureWiring.startGateway(admin.url(), mcp.url());
        await exposureWiring.startProvider();
        await keepAwake.start();
        started = true;
      } catch (error) {
        await cleanup();
        throw error;
      }
    },
    async close() {
      if (!started && !db && !worker && !admin && !mcp) return;
      await cleanup();
    },
  };
}
