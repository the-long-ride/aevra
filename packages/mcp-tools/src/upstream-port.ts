import type { UpstreamCatalog } from '../../mcp-upstream/src/protocol.js';
import type { RiskTier } from '../../protocol/src/index.js';

export type UpstreamState = 'active' | 'degraded' | 'needs-review';

export interface UpstreamServerSummary {
  id: string;
  name: string;
  risk: RiskTier;
  enabled: boolean;
  state: UpstreamState;
}

export interface UpstreamRegistryService {
  list(): UpstreamServerSummary[];
  findByName(name: string): UpstreamServerSummary | null;
  catalogByName(name: string): UpstreamCatalog | null;
  callTool(name: string, tool: string, args: unknown): Promise<unknown>;
  readResource(name: string, uri: string): Promise<unknown>;
  getPrompt(name: string, prompt: string, args?: unknown): Promise<unknown>;
  reconcileChanged?(): Promise<void>;
}

export function servableUpstreams(
  port: UpstreamRegistryService | undefined,
): UpstreamServerSummary[] {
  if (!port) return [];
  return port.list().filter((server) => server.enabled && server.state !== 'needs-review');
}
