import type { VerifiedEnvelope, WorkerResult } from '../../../packages/protocol/src/worker.js';
import type { DesktopOwner } from '../../../packages/protocol/src/desktop.js';
import {
  fileList,
  fileRead,
  fileSearch,
  fileCreate,
  fileWrite,
  fileMove,
  fileDelete,
} from '../../../packages/executor/src/files.js';
import { runCommand } from '../../../packages/executor/src/commands.js';
import { nativeMultiSearch } from '../../../packages/executor/src/native-search.js';
import { runHookProcess } from '../../../packages/executor/src/hook-process.js';
import {
  gitStatus,
  gitAdd,
  gitDiff,
  gitLog,
  gitBranch,
  gitCommit,
  gitPush,
} from '../../../packages/executor/src/git.js';
import { resolveCapabilityPath } from '../../../packages/security/src/path-policy.js';
import { snapshotFile, restoreFile } from '../../../packages/executor/src/recovery.js';
import { processRuntime } from './process-runtime.js';
import { dispatchBrowserOperation, isBrowserOperation } from './browser-dispatch.js';
import { dispatchDesktopOperation, isDesktopOperation } from './desktop-dispatch.js';
import { desktopRuntime } from './desktop-runtime.js';
import { dispatchMcpUpstreamOperation, isMcpUpstreamOperation } from './mcp-upstream-dispatch.js';
import { mcpUpstreamRuntime } from './mcp-upstream-runtime.js';
import { DockerBackend } from '../../../packages/executor/src/docker.js';
import { PodmanBackend } from '../../../packages/executor/src/podman.js';

export async function dispatchWorkerOperation(envelope: VerifiedEnvelope): Promise<WorkerResult> {
  try {
    const op = envelope.operation;
    const roots = envelope.capabilityRoots;
    if (op.kind === 'file.list') return { ok: true, value: await fileList(op.path, roots) };
    if (op.kind === 'file.read') {
      return {
        ok: true,
        value: await fileRead(
          op.path,
          roots,
          { offset: op.offset, length: op.length },
          op.protectedGlobs,
        ),
      };
    }
    if (op.kind === 'file.search') {
      return {
        ok: true,
        value: await fileSearch(op.path, op.query, roots, undefined, op.protectedGlobs),
      };
    }
    if (op.kind === 'search.multi') {
      return {
        ok: true,
        value: await nativeMultiSearch(op.queries, roots, op.maxResultsPerQuery, op.protectedGlobs),
      };
    }
    if (op.kind === 'hook.run') return { ok: true, value: await runHookProcess(op) };
    if (op.kind === 'file.create') {
      return { ok: true, value: await fileCreate(op.path, op.content, roots, op.encoding) };
    }
    if (op.kind === 'file.write') {
      return { ok: true, value: await fileWrite(op.path, op.content, roots, op.encoding) };
    }
    if (op.kind === 'file.move') return { ok: true, value: await fileMove(op.from, op.to, roots) };
    if (op.kind === 'file.delete') {
      return { ok: true, value: await fileDelete(op.path, op.recursive, roots) };
    }
    if (op.kind === 'sandbox.inspect') {
      return { ok: true, value: { ready: true, backend: 'worker' } };
    }
    if (op.kind === 'process.list') return { ok: true, value: processRuntime.list() };
    if (op.kind === 'process.status')
      return { ok: true, value: processRuntime.status(op.processId) };
    if (op.kind === 'process.wait') {
      return { ok: true, value: await processRuntime.wait(op.processId, op.timeoutMs) };
    }
    if (op.kind === 'process.logs') {
      return { ok: true, value: processRuntime.logs(op.processId, Number(op.cursor ?? 0)) };
    }
    if (op.kind === 'process.stop') return { ok: true, value: processRuntime.stop(op.processId) };
    if (op.kind === 'process.restart') {
      return { ok: true, value: processRuntime.restart(op.processId) };
    }

    // Browser operations resolve no filesystem path, so they route before
    // capability-root resolution rather than through it.
    // Awaited, not just returned: a bare `return promise` inside try/catch
    // settles after the catch is out of scope, so driver rejections would
    // escape as unhandled instead of becoming typed worker errors.
    if (isBrowserOperation(op)) return await dispatchBrowserOperation(op);

    // Desktop operations resolve no filesystem path either, and follow the
    // same reasoning as the browser branch above: awaited so a driver
    // rejection becomes a typed worker error instead of an unhandled
    // rejection escaping the try/catch. dispatchDesktopOperation returns the
    // raw result (or throws), so it is wrapped into a WorkerResult here the
    // same way every other branch in this function wraps its own value.
    if (isDesktopOperation(op)) {
      const owner: DesktopOwner = {
        sessionId: envelope.sessionId,
        workspaceId: envelope.workspaceId,
      };
      return {
        ok: true,
        value: await dispatchDesktopOperation(op, desktopRuntime.registry(), owner),
      };
    }
    if (isMcpUpstreamOperation(op)) {
      return {
        ok: true,
        value: await dispatchMcpUpstreamOperation(op, mcpUpstreamRuntime.registry()),
      };
    }

    const cwd = (await resolveCapabilityPath('/', roots, 'command')).canonicalHostPath;
    if (op.kind === 'command.run') {
      if (envelope.executionMode === 'sandbox') {
        const all = [new DockerBackend(), new PodmanBackend()];
        const backends =
          op.sandboxBackend === 'docker'
            ? [all[0]!]
            : op.sandboxBackend === 'podman'
              ? [all[1]!]
              : all;
        for (const backend of backends) {
          if (await backend.available()) {
            const handle = await backend.prepare({
              workspaceId: envelope.workspaceId,
              roots,
              cachePolicy: op.cachePolicy ?? 'workspace',
            });
            try {
              await backend.applyNetworkPolicy(
                handle,
                op.networkPolicy ?? { mode: 'deny-all', destinations: [], enforcement: 'backend' },
              );
              return { ok: true, value: await backend.run(handle, op.command) };
            } finally {
              await backend.terminate(handle);
            }
          }
        }
        return {
          ok: false,
          error: {
            code: 'EXECUTOR_UNAVAILABLE',
            message:
              'No strict sandbox backend is available; host fallback requires separate authorization',
          },
        };
      }
      return { ok: true, value: await runCommand(op.command, cwd) };
    }
    if (op.kind === 'process.start') {
      return { ok: true, value: processRuntime.start(op.command, cwd, op.lifecycle) };
    }
    if (op.kind === 'git.status') return { ok: true, value: await gitStatus(cwd) };
    if (op.kind === 'git.add') return { ok: true, value: await gitAdd(cwd, op.args) };
    if (op.kind === 'git.diff') return { ok: true, value: await gitDiff(cwd, op.args) };
    if (op.kind === 'git.log') return { ok: true, value: await gitLog(cwd, op.args) };
    if (op.kind === 'git.branch') return { ok: true, value: await gitBranch(cwd, op.args) };
    if (op.kind === 'git.commit') {
      return { ok: true, value: await gitCommit(cwd, op.message, op.args) };
    }
    if (op.kind === 'git.push') {
      return { ok: true, value: await gitPush(cwd, op.remote, op.branch, op.args) };
    }
    if (op.kind === 'recovery.snapshot') {
      return { ok: true, value: await snapshotFile(op.path, op.destination, roots) };
    }
    if (op.kind === 'recovery.restore') {
      return { ok: true, value: await restoreFile(op.snapshot, op.path, roots) };
    }
    return {
      ok: false,
      error: { code: 'CAPABILITY_REQUIRED', message: `Operation ${op.kind} is not enabled yet` },
    };
  } catch (e) {
    // `details` is forwarded only when the thrown error actually carries one
    // (so far only `DesktopDriverError` on the input-refused path does, to
    // carry the window identity and gate verdict through to the MCP tool
    // layer's audit call) - every other branch's errors are unaffected.
    const details = (e as any)?.details;
    return {
      ok: false,
      error: {
        code: (e as any)?.code ?? 'INVALID_REQUEST',
        message: e instanceof Error ? e.message : String(e),
        ...(details ? { details } : {}),
      },
    };
  }
}
