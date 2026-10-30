import type { RuntimeExposureWiring } from '../exposure/runtime-wiring.js';
import { AEVRA_VERSION } from '../version.js';

interface RuntimeHealthInput {
  version: string;
  workerRunning: boolean;
  mcpRunning: boolean;
  mcpDiagnostics: unknown;
  exposure: ReturnType<RuntimeExposureWiring['status']> | null;
  safeMode: boolean;
  connectorFailedAttempts: number;
}

function buildRuntimeHealth(input: RuntimeHealthInput) {
  const reachable = input.exposure?.tunnelHealth?.reachable;
  return {
    version: input.version,
    core: 'running',
    worker: input.workerRunning ? 'running' : 'unavailable',
    mcp: input.mcpRunning ? 'running' : 'starting',
    mcpDiagnostics: input.mcpDiagnostics,
    exposure: input.exposure,
    tunnel: input.exposure?.provider === 'local' || !input.exposure ? 'unconfigured' : 'configured',
    tunnelReachable: reachable === true ? true : reachable === false ? false : undefined,
    safeMode: input.safeMode,
    connectorFailedAttempts: input.connectorFailedAttempts,
  };
}

export function resolveRuntimeHealth(
  worker: unknown,
  mcp: { diagnosticsSnapshot?: () => unknown } | undefined,
  exposure: { status?: () => any } | undefined,
  safeMode: boolean,
  failedAttempts: number,
) {
  return buildRuntimeHealth({
    version: AEVRA_VERSION,
    workerRunning: Boolean(worker),
    mcpRunning: Boolean(mcp),
    mcpDiagnostics: mcp?.diagnosticsSnapshot?.() ?? null,
    exposure: exposure?.status?.() ?? null,
    safeMode,
    connectorFailedAttempts: failedAttempts,
  });
}
