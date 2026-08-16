import { randomUUID } from 'node:crypto';
import type { WorkerGateway } from '../../../../packages/mcp-tools/src/service.js';
import type { OperationRepository } from '../../../../packages/store/src/operations.js';
import type { WorkspaceLease } from '../sessions/session-manager.js';
import type { WorkspaceService } from '../workspaces/workspace-service.js';
import type { WorkspaceLockCoordinator } from '../policy/workspace-locks.js';
import type { ChangeSetService } from '../changes/change-service.js';
import type { ReadVersionCache } from './read-version-cache.js';

interface FileMutationDeps {
  workspaces: WorkspaceService;
  worker: WorkerGateway;
  operations: OperationRepository;
  locks: WorkspaceLockCoordinator;
  changes: ChangeSetService;
  reads: ReadVersionCache;
}

function workerError(result: any) {
  return Object.assign(new Error(result.error.message), { code: result.error.code });
}

function applyUnifiedPatch(source: string, patch: string) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const out = [...lines];
  let offset = 0;
  const rows = patch.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < rows.length; i++) {
    const match = rows[i]!.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!match) continue;
    const start = Number(match[1]) - 1 + offset;
    const oldChunk: string[] = [];
    const newChunk: string[] = [];
    i++;
    for (; i < rows.length && !rows[i]!.startsWith('@@ '); i++) {
      const row = rows[i]!;
      if (row.startsWith(' ') || row.startsWith('-')) oldChunk.push(row.slice(1));
      if (row.startsWith(' ') || row.startsWith('+')) newChunk.push(row.slice(1));
    }
    i--;
    const actual = out.slice(start, start + oldChunk.length);
    if (actual.join('\n') !== oldChunk.join('\n')) {
      throw Object.assign(new Error('Patch context does not match file'), {
        code: 'WRITE_CONFLICT',
      });
    }
    out.splice(start, oldChunk.length, ...newChunk);
    offset += newChunk.length - oldChunk.length;
  }
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  return out.join(eol);
}

export async function createFileMutation(
  deps: FileMutationDeps,
  sessionId: string,
  lease: WorkspaceLease,
  input: { path: string; content: string; encoding: 'utf8' | 'base64' },
) {
  const operationId = `op_${randomUUID()}`;
  const roots = deps.workspaces.capabilityRoots(lease.workspaceId);
  const changeSet = await deps.changes.activeOrBegin(sessionId, lease.workspaceId);
  deps.operations.put({
    id: operationId,
    sessionId,
    workspaceId: lease.workspaceId,
    kind: 'file.create',
    state: 'PREPARING',
    intent: input,
    expectedState: { missing: 'true' },
  });
  deps.operations.updateState(operationId, 'AUTHORIZED');
  const lock = await deps.locks.acquire({
    operationId,
    sessionId,
    workspaceId: lease.workspaceId,
    effect: 'SOURCE_MUTATION',
    outputKeys: [],
  });
  try {
    deps.operations.updateState(operationId, 'EXECUTING');
    const result = await deps.worker.execute({
      sessionId,
      workspaceId: lease.workspaceId,
      roots,
      operation: {
        kind: 'file.create',
        path: input.path,
        content: input.content,
        encoding: input.encoding,
      },
    });
    if (!result.ok) throw workerError(result);
    await deps.changes.recordMutation({
      changeSetId: changeSet.id,
      operationId,
      logicalPath: input.path,
      afterHash: (result.value as any).hash,
      metadata: { kind: 'create' },
    } as any);
    deps.operations.updateState(operationId, 'SUCCEEDED', result.value);
    return result.value;
  } catch (error) {
    deps.operations.updateState(operationId, 'FAILED', {
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    lock.release();
  }
}

export async function deleteFileMutation(
  deps: FileMutationDeps,
  sessionId: string,
  lease: WorkspaceLease,
  input: { path: string; recursive: boolean },
) {
  const operationId = `op_${randomUUID()}`;
  const roots = deps.workspaces.capabilityRoots(lease.workspaceId);
  deps.operations.put({
    id: operationId,
    sessionId,
    workspaceId: lease.workspaceId,
    kind: 'file.delete',
    state: 'PREPARING',
    intent: input,
  });
  const recovery = await deps.changes.snapshot(
    sessionId,
    lease.workspaceId,
    input.path,
    operationId,
  );
  deps.operations.updateState(operationId, 'AUTHORIZED', { snapshotPath: recovery.snapshotPath });
  const lock = await deps.locks.acquire({
    operationId,
    sessionId,
    workspaceId: lease.workspaceId,
    effect: 'SOURCE_MUTATION',
    outputKeys: [],
  });
  try {
    deps.operations.updateState(operationId, 'EXECUTING');
    const result = await deps.worker.execute({
      sessionId,
      workspaceId: lease.workspaceId,
      roots,
      operation: { kind: 'file.delete', path: input.path, recursive: input.recursive },
    });
    if (!result.ok) throw workerError(result);
    await deps.changes.recordMutation({
      changeSetId: recovery.changeSet.id,
      operationId,
      logicalPath: input.path,
      snapshotPath: recovery.snapshotPath,
      metadata: { kind: 'delete' },
    } as any);
    deps.operations.updateState(operationId, 'SUCCEEDED', result.value);
    return result.value;
  } catch (error) {
    deps.operations.updateState(operationId, 'FAILED', {
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    lock.release();
  }
}

export async function moveFileMutation(
  deps: FileMutationDeps,
  sessionId: string,
  lease: WorkspaceLease,
  input: { from: string; to: string },
) {
  const operationId = `op_${randomUUID()}`;
  const roots = deps.workspaces.capabilityRoots(lease.workspaceId);
  deps.operations.put({
    id: operationId,
    sessionId,
    workspaceId: lease.workspaceId,
    kind: 'file.move',
    state: 'PREPARING',
    intent: input,
  });
  const recovery = await deps.changes.snapshot(
    sessionId,
    lease.workspaceId,
    input.from,
    operationId,
  );
  deps.operations.updateState(operationId, 'AUTHORIZED', { snapshotPath: recovery.snapshotPath });
  const lock = await deps.locks.acquire({
    operationId,
    sessionId,
    workspaceId: lease.workspaceId,
    effect: 'SOURCE_MUTATION',
    outputKeys: [],
  });
  try {
    deps.operations.updateState(operationId, 'EXECUTING');
    const result = await deps.worker.execute({
      sessionId,
      workspaceId: lease.workspaceId,
      roots,
      operation: { kind: 'file.move', from: input.from, to: input.to },
    });
    if (!result.ok) throw workerError(result);
    await deps.changes.recordMutation({
      changeSetId: recovery.changeSet.id,
      operationId,
      logicalPath: input.from,
      snapshotPath: recovery.snapshotPath,
      metadata: { kind: 'move', to: input.to },
    } as any);
    deps.operations.updateState(operationId, 'SUCCEEDED', result.value);
    return result.value;
  } catch (error) {
    deps.operations.updateState(operationId, 'FAILED', {
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    lock.release();
  }
}

export async function patchFileMutation(
  deps: Pick<FileMutationDeps, 'workspaces' | 'worker' | 'reads'>,
  sessionId: string,
  lease: WorkspaceLease,
  input: { path: string; patch: string; expectedHash?: string },
  write: (content: string, expectedHash: string) => Promise<unknown>,
) {
  const roots = deps.workspaces.capabilityRoots(lease.workspaceId);
  const read = await deps.worker.execute({
    sessionId,
    workspaceId: lease.workspaceId,
    roots,
    operation: { kind: 'file.read', path: input.path },
  });
  if (!read.ok) throw workerError(read);
  const current = read.value as any;
  let source = current.content;
  if (input.expectedHash && input.expectedHash !== current.hash) {
    const base = deps.reads.get(sessionId, lease.workspaceId, current.path, input.expectedHash);
    if (!base) {
      throw Object.assign(new Error('Stale patch base unavailable'), {
        code: 'WRITE_CONFLICT',
      });
    }
    source = base.content;
  }
  const requested = applyUnifiedPatch(source, input.patch);
  return write(requested, input.expectedHash ?? current.hash);
}
