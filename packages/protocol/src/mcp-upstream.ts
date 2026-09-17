import type { UpstreamTransportConfig } from '../../mcp-upstream/src/transport.js';

export const MCP_UPSTREAM_OPERATION_KINDS = [
  'mcp.upstream.connect',
  'mcp.upstream.disconnect',
  'mcp.upstream.status',
  'mcp.upstream.catalog',
  'mcp.upstream.call',
] as const;

export type McpUpstreamOperationKind = (typeof MCP_UPSTREAM_OPERATION_KINDS)[number];

export type McpUpstreamCall =
  | { method: 'tool'; name: string; arguments: unknown }
  | { method: 'resource'; uri: string }
  | { method: 'prompt'; name: string; arguments?: unknown };

export type McpUpstreamSessionState = 'idle' | 'connected' | 'degraded';

export interface McpUpstreamSessionStatus {
  upstreamId: string;
  state: McpUpstreamSessionState;
  server: { name: string; version: string; protocolVersion: string } | null;
  failures: number;
  retryAfter: string | null;
  lastError: string | null;
  listChangedAt: string | null;
}

export type { UpstreamTransportConfig };
