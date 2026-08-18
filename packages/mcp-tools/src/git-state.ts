import type { CapabilityRoot } from '../../protocol/src/index.js';
import type { McpRuntimeContext } from './service-types.js';

export async function repoState(
  context: McpRuntimeContext,
  sessionId: string,
  workspaceId: string,
  roots: CapabilityRoot[],
) {
  const result = await context.worker.execute({
    sessionId,
    workspaceId,
    roots,
    operation: { kind: 'git.log', args: ['-1', '--format=%H'] },
    executionMode: 'host',
  });
  if (!result.ok) return {};
  const stdout = String((result.value as any)?.stdout ?? '').trim();
  const head = stdout.split(/\s+/)[0];
  return head ? { head } : {};
}
