import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { CoreConfig } from './config.js';
import { createConnectorBindings, createRuntimeRepositories } from './runtime-repositories.js';
import { createRuntimeConnectionServices } from './runtime-connection-services.js';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { HostControlGrantRepository } from '../../../packages/store/src/host-control-grants.js';
import { HostControlAccess } from './control/host-control-access.js';
import { HostControlApproval } from './control/host-control-approval.js';
import { installHostControlRevocation } from './control/host-control-revocation.js';
import { SecurityGuard } from './security/security-guard.js';
import { ManifestService } from './workspaces/manifest-service.js';
import { createConnectorAdmission } from './mcp/connector-admission.js';
import { McpActivityLog } from './mcp/activity-log.js';
import { AEVRA_VERSION } from './version.js';
import { MetricsService } from './metrics.js';
import { AdminServer } from './admin/server.js';
import { buildRuntimeHealth } from './admin/runtime-health.js';
import { McpIngressServer } from './mcp/server.js';
import { AdminBootstrapService, ensureLocalControlSecret } from './admin/bootstrap.js';
import * as adminRuntime from './admin/admin-api-context.js';
import { agentAdminContext, prepareStateDirectory } from './admin/agent-integration.js';
import { LocalFilesystemService } from './admin/local-filesystem.js';
import type { WorkerClient } from '../../../packages/ipc/src/client.js';
import { ReadVersionCache } from './operations/read-version-cache.js';
import { ResumableOperationService } from './operations/resumable-operation-service.js';
import { AuditService } from './audit/audit-service.js';
import { PermissionEngine } from './policy/permissions.js';
import { OperationService } from './operations/operation-service.js';
import { ChangeSetService } from './changes/change-service.js';
import { ProcessService } from './processes/process-service.js';
import {
  closeRuntimeResources,
  createBrowserOriginPolicyService,
  createBrowserPairingService,
  createDesktopAccessService,
  createDesktopAppCatalogService,
  createDesktopPolicyService,
  createMcpUpstreams,
  createRuntimeDataServices,
  createRuntimeWorkerManager,
  prepareRuntimeStartup,
  runtimeWorkerGateway,
  syncBrowserPairingStatus,
  configureRuntimeOperations,
} from './runtime-support.js';
import { SessionSkillAccessGate } from '../../../packages/mcp-tools/src/skill-access-gate.js';
import type { CoreRuntime, RuntimeDependencies } from './runtime-types.js';
import { RuntimeExposureWiring } from './exposure/runtime-wiring.js';
import { exposureOrigins } from './exposure/exposure-origins.js';
import type { KeepAwakeService } from './power/keep-awake-service.js';
import { createRuntimeKeepAwakeService } from './power/runtime-keep-awake.js';
import { createRuntimeUsage } from './usage/runtime-usage.js';
import { fileLinksFor } from './files/runtime-file-links.js';
export type { CoreRuntime, RuntimeDependencies } from './runtime-types.js';
export async function createCoreRuntime(
  config: CoreConfig,
  deps: RuntimeDependencies = {},
): Promise<CoreRuntime> {
  let db: AevraDatabase | undefined,
    worker: WorkerClient | undefined,
    admin: AdminServer | undefined;
  let mcp: McpIngressServer | undefined, exposureWiring: RuntimeExposureWiring | undefined;
  let keepAwake: KeepAwakeService | undefined,
    safeMode = false,
    started = false;
  let usageWiring: ReturnType<typeof createRuntimeUsage> | undefined;
  const wm = createRuntimeWorkerManager(config, deps);
  const cleanup = async () => {
    await closeRuntimeResources(
      [keepAwake, exposureWiring, mcp, admin, usageWiring],
      worker ? wm : undefined,
      db,
    );
    keepAwake = exposureWiring = mcp = admin = usageWiring = worker = undefined;
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
        prepareStateDirectory(config);
        const startup = await prepareRuntimeStartup(config, deps);
        const { systemCapabilities, tls, adminCredentialVerifier } = startup;
        db = (deps.databaseOpen ?? AevraDatabase.open)(config.databasePath);
        safeMode = !db.integrityCheck().ok;
        const raw = db.raw();
        const repositories = createRuntimeRepositories(raw);
        const {
          settings,
          workspaceRepo,
          sessionRepo,
          permissionRepo,
          approvalRepo,
          operationRepo,
          controlPlanRepo,
          changeRepo,
          auditRepo,
          processRepo,
          connectorRepo,
          oauthRepo,
        } = repositories;
        const connectorBindings = createConnectorBindings(connectorRepo);
        const {
          workspaces,
          profiles,
          connectionLimiter,
          invalidBearerLimiter,
          connectorLimiter,
          sessions,
          connections,
        } = createRuntimeConnectionServices(config, raw, {
          oauthRepo,
          processRepo,
          workspaceRepo,
          sessionRepo,
        });
        const audit = new AuditService(auditRepo),
          permissions = new PermissionEngine(permissionRepo),
          reads = new ReadVersionCache(),
          security = new SecurityGuard(sessions, workspaces, new ManifestService(workspaces));
        const hostControlAccess = new HostControlAccess(
          sessions,
          new HostControlGrantRepository(raw),
          (id) => connectorRepo.isActive(id),
        );
        connections.setControlAccess(hostControlAccess);
        operationRepo.setConnectionResolver(
          (sessionId) => sessions.connectionIdentity(sessionId)?.connectionId,
        );
        const resumableOperations = new ResumableOperationService(operationRepo, sessions);
        controlPlanRepo.reconcileIncomplete();
        sessions.invalidateForRestart();
        oauthRepo.invalidateEphemeralForRestart();
        if (!safeMode) worker = await wm.start();
        const workerGateway = runtimeWorkerGateway(wm, safeMode);
        installHostControlRevocation(hostControlAccess, workerGateway);
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
        configureRuntimeOperations(operations, changes, sessions, settings);
        if (!safeMode) await changes.reconcileIncompleteOperations();
        const approvals = adminRuntime.createRuntimeApprovalService(
          approvalRepo,
          audit,
          config,
          safeMode,
          sessions,
        );
        const hostControlApproval = new HostControlApproval(sessions, hostControlAccess, approvals);
        const metrics = new MetricsService(),
          browserPairing = createBrowserPairingService(settings, wm, workerGateway, config),
          browserPolicy = createBrowserOriginPolicyService(settings, config, () =>
            exposureOrigins(exposureWiring),
          ),
          desktopPolicy = createDesktopPolicyService(settings),
          desktopAccess = createDesktopAccessService(
            db!,
            workerGateway,
            sessions,
            workspaces,
            audit,
            hostControlAccess,
          ),
          desktopAppCatalog = createDesktopAppCatalogService(db!, desktopAccess, audit),
          activity = new McpActivityLog(),
          dataServices = await createRuntimeDataServices(config, db);
        const mcpUpstreams = createMcpUpstreams(db, workerGateway, dataServices.secretStore);
        usageWiring = createRuntimeUsage(raw, settings);
        const gatewayTrustSecret = randomBytes(32).toString('base64url');
        exposureWiring = new RuntimeExposureWiring(
          config,
          settings,
          oauthRepo,
          tls,
          deps.cloudflare,
          gatewayTrustSecret,
          audit,
        );
        const links = [sessions, workspaces, workerGateway, audit, exposureWiring] as const;
        const files = fileLinksFor(...links, () => connectorsAdmission);
        const tools = adminRuntime.createCoreToolService(
          sessions,
          workspaces,
          workerGateway,
          reads,
          approvals,
          {
            operations,
            hostControlAccess,
            hostControlApproval,
            resumableOperations,
            controlPlans: controlPlanRepo,
            processes,
            changes,
            permissions,
            security,
            audit,
            connectorBindings,
            metrics,
            settings,
            desktopAccess,
            desktopAppCatalog,
            systemCapabilities,
            browserPairing,
            browserPolicy,
            upstreams: mcpUpstreams,
            ...usageWiring.tools,
            ...files.tools,
          },
        );
        const remoteTools = new SessionSkillAccessGate(tools, sessions, approvals);
        const bootstrap = new AdminBootstrapService(raw);
        await bootstrap.revokeAll();
        const controlSecret = ensureLocalControlSecret(config.stateDir);
        const localFilesystem = new LocalFilesystemService();
        const localTls = tls.serverOptions;
        const staticDir = fileURLToPath(new URL('../../web', import.meta.url));
        const oauth = exposureWiring.oauth;
        admin = adminRuntime.createRuntimeAdminServer(
          config,
          {
            bootstrap,
            credentialVerifier: adminCredentialVerifier,
            controlSecret,
            staticDir,
            localTls,
            exposureWiring,
            trustedAdminOrigins: config.trustedAdminOrigins,
            gatewayTrustSecret,
            api: adminRuntime.buildAdminApiContext({
              ...agentAdminContext(config, connectorRepo, sessions, cleanup),
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
              exposureWiring,
              localFilesystem,
              oauth,
              connections,
              hostControlAccess,
              environment: dataServices.environment,
              vault: dataServices.vault,
              database: dataServices.databaseAdmin,
              connectors: connectorRepo,
              metrics,
              activity,
              keepAwake,
              browserPairing,
              browserPolicy,
              desktopPolicy,
              desktopAccess,
              desktopAppCatalog,
              mcpUpstreams,
              systemCapabilities: () => systemCapabilities,
              getMcpDiagnostics: () => mcp?.diagnosticsSnapshot() ?? null,
              isSafeMode: () => safeMode,
              commandEvaluator: tools.evaluateCommandInput.bind(tools),
              ...usageWiring.admin,
            }),
          },
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
        );
        const connectorsAdmission = createConnectorAdmission(connectorRepo, connectorLimiter);
        mcp = new McpIngressServer(
          config.mcpHost,
          config.mcpPort,
          exposureWiring.verifier,
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
            trustForwardedClientIp: () => exposureWiring?.trustForwardedClientIp() === true,
            connectionLimiter,
            invalidBearerLimiter,
            ...usageWiring.mcp,
            ...files.mcp,
          },
        );
        await Promise.all([admin.start(), mcp.start()]);
        await exposureWiring.startGateway(admin.url(), mcp.url());
        await exposureWiring.startProvider();
        await keepAwake.start();
        await syncBrowserPairingStatus(browserPairing, workerGateway);
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
