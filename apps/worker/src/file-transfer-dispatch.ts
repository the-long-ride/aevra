import type { CapabilityRoot } from '../../../packages/protocol/src/index.js';
import type { FileTransferOperation } from '../../../packages/protocol/src/file-transfer-ops.js';
import type { WorkerOperation } from '../../../packages/protocol/src/worker.js';
import {
  downloadEntry,
  uploadRead,
  uploadStat,
  type TransferDeps,
} from '../../../packages/executor/src/file-transfer.js';
import { StreamError } from '../../../packages/ipc/src/stream.js';
import type { StreamContext } from '../../../packages/ipc/src/stream-server.js';

export function isFileTransferOperation(op: WorkerOperation): op is FileTransferOperation {
  return op.kind.startsWith('files.');
}

function coded(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

const finitePositive = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * Routes the three transfer operations. Bytes never ride the result: inline
 * content arrives on `ctx.upload` and file content leaves through
 * `ctx.download`. A failure after the first byte was pushed aborts the stream
 * with the error code (a bare error result would arrive after a partial body).
 */
export async function dispatchFileTransferOperation(
  op: FileTransferOperation,
  roots: CapabilityRoot[],
  ctx?: StreamContext,
  deps?: TransferDeps,
): Promise<unknown> {
  if (op.kind === 'files.download.entry') {
    // An unbounded size or time budget would let one entry run forever.
    if (!finitePositive(op.maxBytes) || !finitePositive(op.timeoutMs)) {
      throw coded('INVALID_REQUEST', 'maxBytes and timeoutMs must be finite positive numbers');
    }
    return downloadEntry(op, roots, ctx?.upload ? { upload: ctx.upload } : {}, deps);
  }
  if (op.kind === 'files.upload.stat') {
    if (op.hash !== undefined && typeof op.hash !== 'boolean') {
      throw coded('INVALID_REQUEST', 'hash must be a boolean');
    }
    return uploadStat(op.path, roots, op.protectedGlobs, { hash: op.hash !== false });
  }
  if (op.timeoutMs !== undefined && !finitePositive(op.timeoutMs)) {
    throw coded('INVALID_REQUEST', 'timeoutMs must be a finite positive number');
  }
  const download = ctx?.download;
  if (!download) throw coded('INVALID_REQUEST', 'files.upload.read requires a download stream');
  let started = false;
  try {
    return await uploadRead(
      op.path,
      op.sha256,
      roots,
      async (chunk) => {
        started = true;
        await download(chunk);
      },
      op.protectedGlobs,
    );
  } catch (error) {
    if (!started || error instanceof StreamError) throw error;
    const code = (error as { code?: unknown }).code;
    throw new StreamError(
      typeof code === 'string' && code ? code : 'STREAM_SOURCE_ERROR',
      error instanceof Error ? error.message : String(error),
    );
  }
}
