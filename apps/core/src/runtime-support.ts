import path from 'node:path';
import type { WorkerGateway } from '../../../packages/mcp-tools/src/service.js';
import type { CoreConfig } from './config.js';
import type { RuntimeDependencies } from './runtime-types.js';
import {
  detectSystemCapabilities,
  fallbackSystemCapabilitySnapshot,
} from './system/capability-detector.js';
import { ensureLocalTls } from './tls/local-tls.js';
import { WorkerManager } from './worker/worker-manager.js';
import { BrowserPairingService } from './browser/pairing-service.js';
import { BrowserOriginPolicyService } from './browser/origin-policy-service.js';
import { DesktopPolicyService } from './desktop/desktop-policy-service.js';
import { DesktopAccessService } from './desktop/desktop-access-service.js';
import { DesktopAppCatalogService } from './desktop/desktop-app-catalog.js';
import type { AevraDatabase } from '../../../packages/store/src/database.js';
import { DesktopAccessRepository } from '../../../packages/store/src/desktop-access.js';
import { DesktopAppCatalogRepository } from '../../../packages/store/src/desktop-app-catalog.js';
import { EncryptedVault } from '../../../packages/secrets/src/vault.js';
import { CommandSecretStore } from '../../../packages/secrets/src/platform.js';
import { EnvironmentService } from './secrets/environment-service.js';
import { ConfigExportService } from './config/export-service.js';
import { BackupService } from './backup/backup-service.js';
import type { SettingsRepository } from '../../../packages/store/src/settings.js';
import { UpstreamRegistryService } from './mcp-upstream/upstream-registry-service.js';
import { UpstreamRepository } from './mcp-upstream/upstream-repository.js';
import type { UpstreamCatalog } from '../../../packages/mcp-upstream/src/protocol.js';
import type { UpstreamTransportConfig } from '../../../packages/mcp-upstream/src/transport.js';
import type { McpUpstreamCall } from '../../../packages/protocol/src/mcp-upstream.js';
import type { McpUpstreamSessionStatus } from '../../../packages/protocol/src/mcp-upstream.js';
import type { WorkerOperation } from '../../../packages/protocol/src/worker.js';
import type { SecretStore } from '../../../packages/secrets/src/store.js';
import type { SessionManager } from './sessions/session-manager.js';
import type { WorkspaceService } from './workspaces/workspace-service.js';
import type { AuditService } from './audit/audit-service.js';
export function createRuntimeWorkerManager(config: CoreConfig, deps: RuntimeDependencies) {
  return (
    deps.worker ??
    new WorkerManager(config.workerSocketPath, path.join(config.stateDir, 'process-logs'))
  );
}

/**
 * Resolves the extension-token key lazily. A test double supplied through
 * `deps.worker` need not implement it, and in safe mode the worker never
 * starts - either way pairing fails loudly rather than minting with a key
 * that does not exist.
 */
function browserTokenKeyResolver(
  worker: ReturnType<typeof createRuntimeWorkerManager>,
): () => Buffer {
  return () => {
    const key = (worker as { browserTokenKey?: () => Buffer }).browserTokenKey?.();
    if (!key) {
      throw Object.assign(new Error('Execution Worker unavailable'), {
        code: 'EXECUTOR_UNAVAILABLE',
      });
    }
    return key;
  };
}

export function createBrowserPairingService(
  settings: Pick<SettingsRepository, 'get' | 'set'>,
  worker: ReturnType<typeof createRuntimeWorkerManager>,
  gateway: WorkerGateway,
): BrowserPairingService {
  return new BrowserPairingService(settings, gateway, browserTokenKeyResolver(worker));
}

/**
 * The browser port has no CoreConfig field of its own yet, so it is read
 * directly from the environment here, matching AEVRA_BROWSER_PORT's default
 * used by the browser pairing listener.
 *
 * `origins` is resolved lazily on every snapshot rather than captured once:
 * exposure wiring is constructed after this service, and a tunnel can be
 * turned on, renamed, or turned off long after startup. A stale list here is
 * an origin the agent may drive that serves Aevra's own admin surface.
 */
export function createBrowserOriginPolicyService(
  settings: Pick<SettingsRepository, 'get' | 'set'>,
  config: Pick<CoreConfig, 'publicPort' | 'adminPort' | 'mcpPort'>,
  origins: () => Array<string | undefined> = () => [],
): BrowserOriginPolicyService {
  return new BrowserOriginPolicyService(
    settings,
    () => ({
      publicPort: config.publicPort,
      adminPort: config.adminPort,
      mcpPort: config.mcpPort,
      browserPort: Number(process.env.AEVRA_BROWSER_PORT ?? 47833),
    }),
    origins,
  );
}

export function createDesktopPolicyService(
  settings: Pick<SettingsRepository, 'get' | 'set'>,
): DesktopPolicyService {
  return new DesktopPolicyService(settings);
}

export function createDesktopAccessService(
  database: AevraDatabase,
  worker: WorkerGateway,
  sessions: SessionManager,
  workspaces: WorkspaceService,
  audit: AuditService,
): DesktopAccessService {
  return new DesktopAccessService({
    repository: new DesktopAccessRepository(database.raw()),
    worker,
    sessions,
    capabilityRoots: (workspaceId) => workspaces.capabilityRoots(workspaceId),
    audit,
  });
}

export function createDesktopAppCatalogService(
  database: AevraDatabase,
  access: DesktopAccessService,
  audit: AuditService,
): DesktopAppCatalogService {
  return new DesktopAppCatalogService({
    repository: new DesktopAppCatalogRepository(database.raw()),
    access,
    audit,
  });
}

export function createMcpUpstreams(
  database: AevraDatabase,
  worker: WorkerGateway,
  secrets: SecretStore,
) {
  const repository = new UpstreamRepository(database.raw());
  const execute = async <T>(operation: WorkerOperation): Promise<T> => {
    const result = await worker.execute({
      sessionId: 'mcp-admin',
      workspaceId: 'mcp-upstreams',
      roots: [],
      operation,
      executionMode: 'host',
    });
    if (!result?.ok)
      throw Object.assign(new Error(result?.error?.message ?? 'Upstream worker operation failed'), {
        code: result?.error?.code ?? 'UPSTREAM_CALL_FAILED',
      });
    return result.value as T;
  };
  return new UpstreamRegistryService({
    repository,
    secrets,
    worker: {
      connect: async (upstreamId: string, config: UpstreamTransportConfig) => {
        await execute({ kind: 'mcp.upstream.connect', upstreamId, config });
      },
      catalog: (upstreamId: string) =>
        execute<UpstreamCatalog>({ kind: 'mcp.upstream.catalog', upstreamId }),
      disconnect: (upstreamId: string) => execute({ kind: 'mcp.upstream.disconnect', upstreamId }),
      status: async (upstreamId: string) => {
        const statuses = await execute<McpUpstreamSessionStatus[]>({
          kind: 'mcp.upstream.status',
          upstreamId,
        });
        return statuses[0] ?? null;
      },
      call: (upstreamId: string, call: McpUpstreamCall) =>
        execute({ kind: 'mcp.upstream.call', upstreamId, call }),
    },
  });
}

export async function resolveRuntimeTls(config: CoreConfig, deps: RuntimeDependencies) {
  if (deps.tls) return deps.tls;
  if (deps.ensureTls) return deps.ensureTls(config);
  return ensureLocalTls(config.stateDir, {
    certificatePath: config.tlsCertPath,
    keyPath: config.tlsKeyPath,
    caPath: config.tlsCaPath,
  });
}

export function createCachedSystemCapabilityResolver<T>(scan: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | undefined;
  return () => (cached ??= scan());
}

const resolveDefaultSystemCapabilities =
  createCachedSystemCapabilityResolver(detectSystemCapabilities);

export async function resolveRuntimeSystemCapabilities(deps: RuntimeDependencies) {
  try {
    return await (deps.detectSystemCapabilities ?? resolveDefaultSystemCapabilities)();
  } catch {
    return fallbackSystemCapabilitySnapshot();
  }
}

export async function closeRuntimeResource(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch {
    /* Preserve the original startup/shutdown error. */
  }
}

export function runtimeWorkerGateway(
  worker: ReturnType<typeof createRuntimeWorkerManager>,
  safeMode: boolean,
): WorkerGateway {
  if (safeMode || typeof worker.execute !== 'function') return unavailableWorkerGateway();
  return { execute: (input) => worker.execute!(input) };
}
function unavailableWorkerGateway(): WorkerGateway {
  return {
    async execute() {
      return {
        ok: false,
        error: { code: 'EXECUTOR_UNAVAILABLE', message: 'Execution Worker unavailable' },
      } as any;
    },
  };
}

/**
 * Secrets, config export and backup wiring. Grouped here because the three share
 * one input - the open database and the state directory - and nothing in `start()`
 * needs the intermediate stores, only the vault, the environment service and the
 * admin surface built over them.
 */
export async function createRuntimeDataServices(config: CoreConfig, db: AevraDatabase) {
  const raw = db.raw();
  const vault = new EncryptedVault(path.join(config.stateDir, 'secrets.vault'));
  const platformSecrets = new CommandSecretStore(process.platform);
  const secretStore = (await platformSecrets.probe()) ? platformSecrets : vault;
  const configExport = new ConfigExportService(raw);
  const backup = new BackupService(db, path.join(config.stateDir, 'backups'));
  return {
    vault,
    secretStore,
    environment: new EnvironmentService(raw, secretStore),
    databaseAdmin: {
      configExport: (portable: boolean) => configExport.export(portable),
      configPreview: (value: any) => configExport.previewImport(value),
      configImport: (value: any) => configExport.import(value),
      backup: () => backup.create('daily'),
    },
  };
}

export async function syncBrowserPairingStatus(
  browserPairing: BrowserPairingService,
  workerGateway: WorkerGateway,
): Promise<void> {
  const initialPairing = browserPairing.state();
  if (initialPairing.extensionId) {
    await workerGateway
      .execute({
        sessionId: 'admin:browser',
        workspaceId: 'system',
        roots: [],
        operation: {
          kind: 'browser.status',
          epoch: initialPairing.epoch,
          extensionId: initialPairing.extensionId,
        },
      })
      .catch(() => {});
  }
}
