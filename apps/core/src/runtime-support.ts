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

export function createRuntimeWorkerManager(config: CoreConfig, deps: RuntimeDependencies) {
  return (
    deps.worker ??
    new WorkerManager(config.workerSocketPath, path.join(config.stateDir, 'process-logs'))
  );
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
export function unavailableWorkerGateway(): WorkerGateway {
  return {
    async execute() {
      return {
        ok: false,
        error: { code: 'EXECUTOR_UNAVAILABLE', message: 'Execution Worker unavailable' },
      } as any;
    },
  };
}
