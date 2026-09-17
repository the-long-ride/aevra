import type { WorkerOperation } from '../../../packages/protocol/src/worker.js';
import type { UpstreamSessionRegistry } from './mcp-upstream-runtime.js';

type McpUpstreamOperation = Extract<WorkerOperation, { kind: `mcp.upstream.${string}` }>;

export function isMcpUpstreamOperation(op: WorkerOperation): op is McpUpstreamOperation {
  return op.kind.startsWith('mcp.upstream.');
}

export async function dispatchMcpUpstreamOperation(
  operation: McpUpstreamOperation,
  registry: UpstreamSessionRegistry,
): Promise<unknown> {
  if (operation.kind === 'mcp.upstream.connect')
    return registry.connect(operation.upstreamId, operation.config);
  if (operation.kind === 'mcp.upstream.disconnect') {
    await registry.disconnect(operation.upstreamId);
    return { disconnected: operation.upstreamId ?? 'all' };
  }
  if (operation.kind === 'mcp.upstream.status') return registry.status(operation.upstreamId);
  if (operation.kind === 'mcp.upstream.catalog') return registry.catalog(operation.upstreamId);
  return registry.call(operation.upstreamId, operation.call);
}
