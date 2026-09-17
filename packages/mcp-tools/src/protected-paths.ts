import type { ProtectedGlob } from '../../protocol/src/worker.js';
import type { McpRuntimeContext } from './service-types.js';

/**
 * The workspace's declared protected paths, in the shape a worker operation
 * carries.
 *
 * `SecurityGuard` authorizes a file call against these already, but that check
 * sees one path - the argument. `file_search` and `search` authorize their
 * search ROOT and then hand the executor a walk that opens many other files,
 * and the executor knows only the built-in rules unless it is told. Sending
 * the globs with the operation is what makes a declared `protectedPaths` entry
 * cover the hits as well as the request.
 *
 * Returns `undefined` rather than `[]` when there is nothing to send, so the
 * field stays off the wire entirely for workspaces with no manifest.
 */
export function protectedGlobsFor(
  context: McpRuntimeContext,
  workspaceId: string,
): ProtectedGlob[] | undefined {
  const globs = context.deps.manifests?.globsFor?.(workspaceId);
  return globs?.length ? globs : undefined;
}
