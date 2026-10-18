import {
  recommendTunnelTool,
  type TunnelToolId,
  type TunnelToolStatus,
  type TunnelToolsStatus,
} from '../../../../packages/admin-contracts/src/tunnel-tools.js';
import {
  DefaultCapabilityProbeRunner,
  normalizeVersion,
  type CapabilityProbeRunner,
} from './capability-detector.js';

const PROBE_TIMEOUT_MS = 1_500;

async function probeTunnelTool(
  id: TunnelToolId,
  runner: CapabilityProbeRunner,
): Promise<TunnelToolStatus> {
  try {
    const result = await runner.run(id, ['--version'], PROBE_TIMEOUT_MS);
    if (result.timedOut || result.exitCode !== 0) return { available: false };
    const version = normalizeVersion(result);
    return version ? { available: true, version } : { available: true };
  } catch {
    return { available: false };
  }
}

/** Probes cloudflared and ngrok with the same bounded runner as host capability detection. */
export async function detectTunnelTools(
  options: { runner?: CapabilityProbeRunner } = {},
): Promise<TunnelToolsStatus> {
  const runner = options.runner ?? new DefaultCapabilityProbeRunner();
  const [cloudflared, ngrok] = await Promise.all([
    probeTunnelTool('cloudflared', runner),
    probeTunnelTool('ngrok', runner),
  ]);
  return { cloudflared, ngrok, recommended: recommendTunnelTool({ cloudflared, ngrok }) };
}
