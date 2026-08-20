import type { VerifiedEnvelope, WorkerResult } from '../../../packages/protocol/src/worker.js';
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
import {
  gitStatus,
  gitDiff,
  gitLog,
  gitBranch,
  gitCommit,
  gitPush,
} from '../../../packages/executor/src/git.js';
import { resolveCapabilityPath } from '../../../packages/security/src/path-policy.js';
import { snapshotFile, restoreFile } from '../../../packages/executor/src/recovery.js';
import { processRuntime } from './process-runtime.js';
import { DockerBackend } from '../../../packages/executor/src/docker.js';
import { PodmanBackend } from '../../../packages/executor/src/podman.js';
export async function dispatchWorkerOperation(envelope: VerifiedEnvelope): Promise<WorkerResult> {
  try {
    const op = envelope.operation,
      roots = envelope.capabilityRoots;
    if (op.kind === 'file.list') return { ok: true, value: await fileList(op.path, roots) };
    if (op.kind === 'file.read')
      return {
        ok: true,
        value: await fileRead(op.path, roots, { offset: op.offset, length: op.length }),
      };
    if (op.kind === 'file.search')
      return { ok: true, value: await fileSearch(op.path, op.query, roots) };
    if (op.kind === 'file.create')
      return { ok: true, value: await fileCreate(op.path, op.content, roots, op.encoding) };
    if (op.kind === 'file.write')
      return { ok: true, value: await fileWrite(op.path, op.content, roots, op.encoding) };
    if (op.kind === 'file.move') return { ok: true, value: await fileMove(op.from, op.to, roots) };
    if (op.kind === 'file.delete')
      return { ok: true, value: await fileDelete(op.path, op.recursive, roots) };
    if (op.kind === 'sandbox.inspect')
      return { ok: true, value: { ready: true, backend: 'worker' } };
    if (op.kind === 'process.list') return { ok: true, value: processRuntime.list() };
    if (op.kind === 'process.status') return { ok: true, value: processRuntime.status(op.processId) };
    if (op.kind === 'process.wait')
      return { ok: true, value: await processRuntime.wait(op.processId, op.timeoutMs) };
    if (op.kind === 'process.logs')
      return { ok: true, value: processRuntime.logs(op.processId, Number(op.cursor ?? 0)) };
    if (op.kind === 'process.stop') return { ok: true, value: processRuntime.stop(op.processId) };
    if (op.kind === 'process.restart')
      return { ok: true, value: processRuntime.restart(op.processId) };
    const cwd = (await resolveCapabilityPath('/', roots, 'command')).canonicalHostPath;
    if (op.kind === 'command.run') {
      if (envelope.executionMode === 'sandbox') {
        const all = [new DockerBackend(), new PodmanBackend()],
          backends =
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
    if (op.kind === 'process.start')
      return { ok: true, value: processRuntime.start(op.command, cwd, op.lifecycle) };
    if (op.kind === 'git.status') return { ok: true, value: await gitStatus(cwd) };
    if (op.kind === 'git.diff') return { ok: true, value: await gitDiff(cwd, op.args) };
    if (op.kind === 'git.log') return { ok: true, value: await gitLog(cwd, op.args) };
    if (op.kind === 'git.branch') return { ok: true, value: await gitBranch(cwd, op.args) };
    if (op.kind === 'git.commit')
      return { ok: true, value: await gitCommit(cwd, op.message, op.args) };
    if (op.kind === 'git.push')
      return { ok: true, value: await gitPush(cwd, op.remote, op.branch, op.args) };
    if (op.kind === 'recovery.snapshot')
      return { ok: true, value: await snapshotFile(op.path, op.destination, roots) };
    if (op.kind === 'recovery.restore')
      return { ok: true, value: await restoreFile(op.snapshot, op.path, roots) };
    return {
      ok: false,
      error: { code: 'CAPABILITY_REQUIRED', message: `Operation ${op.kind} is not enabled yet` },
    };
  } catch (e) {
    return {
      ok: false,
      error: {
        code: (e as any)?.code ?? 'INVALID_REQUEST',
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
}
