import { randomUUID } from 'node:crypto';
import {
  FILE_TRANSFER_SETTING_KEY,
  normalizeTransferLimits,
  transferLimitBytes,
} from '../../protocol/src/file-transfer.js';
import type { FileTransferOperation } from '../../protocol/src/file-transfer-ops.js';
import { classifySensitivity } from '../../security/src/sensitive.js';
import { AevraToolError } from './errors.js';
import { protectedGlobsFor } from './protected-paths.js';
import { requiredLease } from './service-helpers.js';
import type { McpRuntimeContext } from './service-types.js';
import {
  assertTransferPermitted,
  requestTransferApproval,
  transferApproved,
  transferNeedsApproval,
} from './transfer-approval.js';
import {
  countHeaders,
  parseTransferEntries,
  summarizeEntries,
  transferTimeoutMs,
  type ParsedEntry,
  isMissingCode,
} from './transfer-entries.js';

const CAPABILITY = 'files.write' as const;
/** Same ceiling the change set uses; beyond it an overwritten file is not snapshotted (R7). */
const MAX_SNAPSHOT_BYTES = 20 * 1024 * 1024;
const CHUNK_BYTES = 256 * 1024;

interface Failure {
  path: string;
  ok: false;
  error: { code: string; message: string };
}

interface Success {
  path: string;
  ok: true;
  bytes: number;
  sha256: string;
  mimeType: string;
  mimeMismatch: boolean;
  recoverable: boolean;
}

function failure(path: string, code: string, message: string): Failure {
  return { path, ok: false, error: { code, message } };
}

function thrownFailure(path: string, error: unknown): Failure {
  const code = (error as any)?.code;
  return failure(
    path,
    typeof code === 'string' ? code : 'EXECUTOR_UNAVAILABLE',
    error instanceof Error ? error.message : String(error),
  );
}

async function* inlineChunks(data: Buffer): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < data.length; offset += CHUNK_BYTES) {
    yield data.subarray(offset, offset + CHUNK_BYTES);
  }
}

/** A transfer may only write where file_write could: secret and protected paths are refused. */
function assertWritable(
  context: McpRuntimeContext,
  sessionId: string,
  workspaceId: string,
  path: string,
) {
  const security = context.deps.security;
  const decision = security
    ? security.authorizeResource({
        sessionId,
        workspaceId,
        capability: CAPABILITY,
        operation: 'write',
        logicalPath: path,
        mutation: true,
      }).decision
    : classifySensitivity({ path }) === 'NORMAL'
      ? 'allow'
      : 'deny';
  if (decision !== 'allow') {
    throw new AevraToolError(
      'CAPABILITY_REQUIRED',
      `Protected resource cannot be written by a transfer: ${path}`,
    );
  }
}

export async function handleFilesDownload(
  context: McpRuntimeContext,
  sessionId: string,
  args: any,
) {
  const entries = parseTransferEntries(args);
  assertTransferPermitted(context, sessionId, CAPABILITY);
  // URL entries reach the network, so a remembered DENY on it blocks the batch.
  if (entries.some((entry) => entry.url)) assertTransferPermitted(context, sessionId, 'network');
  if (
    transferNeedsApproval(context, sessionId) &&
    !transferApproved(context, sessionId, CAPABILITY)
  ) {
    return requestTransferApproval(context, sessionId, {
      direction: 'download',
      tool: 'files_download',
      capability: CAPABILITY,
      args,
      storedArgs: { entries: summarizeEntries(entries) },
      entries: summarizeEntries(entries),
      headersSupplied: countHeaders(entries),
    });
  }
  return runBatch(context, sessionId, entries);
}

async function runBatch(context: McpRuntimeContext, sessionId: string, entries: ParsedEntry[]) {
  const lease = requiredLease(context, sessionId);
  const session = context.sessions.get(sessionId)!;
  const limits = transferLimitBytes(
    normalizeTransferLimits(context.deps.settings?.get(FILE_TRANSFER_SETTING_KEY, {})),
  );
  const call = {
    sessionId,
    workspaceId: lease.workspaceId,
    roots: context.workspaces.capabilityRoots(lease.workspaceId),
    executionMode: 'host' as const,
  };
  const globs = protectedGlobsFor(context, lease.workspaceId);
  let used = 0;
  const results: Array<Success | Failure> = [];

  for (const entry of entries) {
    try {
      assertWritable(context, sessionId, lease.workspaceId, entry.path);
      if (entry.bytes !== undefined && entry.bytes > limits.inline) {
        results.push(
          failure(entry.path, 'INLINE_TOO_LARGE', 'Inline content exceeds the inline limit'),
        );
        continue;
      }
      const remaining = limits.batch - used;
      if ((entry.bytes ?? 1) > remaining) {
        results.push(failure(entry.path, 'BATCH_LIMIT', 'Batch size limit reached'));
        continue;
      }
      const maxBytes = Math.min(limits.file, remaining);
      const outcome = await transferOne(context, call, globs, entry, maxBytes);
      if (outcome.ok) used += outcome.bytes;
      results.push(outcome);
    } catch (error) {
      results.push(thrownFailure(entry.path, error));
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  context.deps.audit?.append({
    actor: session.actor,
    sessionId,
    workspaceId: lease.workspaceId,
    tool: 'files_download',
    operation: 'files:transfer',
    risk: 'HIGH',
    result: `${succeeded}/${results.length}`,
    redactionCount: 0,
  });
  return {
    ok: succeeded === results.length,
    count: results.length,
    succeeded,
    failed: results.length - succeeded,
    results,
  };
}

async function transferOne(
  context: McpRuntimeContext,
  call: {
    sessionId: string;
    workspaceId: string;
    roots: any;
    executionMode: 'host';
  },
  globs: ReturnType<typeof protectedGlobsFor>,
  entry: ParsedEntry,
  maxBytes: number,
): Promise<Success | Failure> {
  const changes = context.deps.changes;
  if (!changes) throw new AevraToolError('RECOVERY_REQUIRED', 'Recovery journal not active');

  let existed = false;
  let beforeHash: string | undefined;
  let snapshotPath: string | undefined;
  let changeSetId: string | undefined;

  if (entry.overwrite) {
    const statOp = (hash: boolean) =>
      context.worker.execute({
        ...call,
        operation: {
          kind: 'files.upload.stat',
          path: entry.path,
          hash,
          ...(globs ? { protectedGlobs: globs } : {}),
        },
      });
    // Existence and size first, without reading the file; hash only what will be snapshotted.
    let stat = await statOp(false);
    if (stat.ok && (stat.value as { bytes: number }).bytes <= MAX_SNAPSHOT_BYTES) {
      stat = await statOp(true);
    }
    if (stat.ok) {
      const value = stat.value as { bytes: number; sha256?: string };
      existed = true;
      beforeHash = value.sha256;
      if (value.bytes <= MAX_SNAPSHOT_BYTES) {
        const recovery = await changes.snapshot(
          call.sessionId,
          call.workspaceId,
          entry.path,
          `op_${randomUUID()}`,
        );
        snapshotPath = recovery.snapshotPath;
        changeSetId = recovery.changeSet.id;
      }
    } else if (!isMissingCode(stat.error.code)) {
      return failure(entry.path, stat.error.code, stat.error.message);
    }
  }

  const operation: FileTransferOperation = {
    kind: 'files.download.entry',
    path: entry.path,
    mimeType: entry.mimeType,
    overwrite: entry.overwrite,
    source: entry.url
      ? { type: 'url', url: entry.url, ...(entry.headers ? { headers: entry.headers } : {}) }
      : { type: 'inline' },
    maxBytes,
    timeoutMs: transferTimeoutMs(maxBytes),
  };
  // A failed write leaves the target untouched, so the snapshot taken for it is dropped.
  const discard = async () => {
    if (snapshotPath) {
      await changes.discardSnapshot(call.sessionId, call.workspaceId, snapshotPath).catch(() => {});
    }
  };
  let result;
  try {
    if (entry.content !== undefined) {
      if (!context.worker.executeWithUpload) {
        await discard();
        return failure(entry.path, 'EXECUTOR_UNAVAILABLE', 'Worker cannot receive inline content');
      }
      result = await context.worker.executeWithUpload(
        { ...call, operation },
        inlineChunks(Buffer.from(entry.content, 'base64')),
      );
    } else {
      result = await context.worker.execute({ ...call, operation });
    }
  } catch (error) {
    await discard();
    throw error;
  }
  if (!result.ok) {
    await discard();
    return failure(entry.path, result.error.code, result.error.message);
  }

  const value = result.value as Omit<Success, 'path' | 'ok' | 'recoverable'>;
  const recoverable = !existed || snapshotPath !== undefined;
  try {
    changeSetId ??= (await changes.activeOrBegin(call.sessionId, call.workspaceId)).id;
    await changes.recordMutation({
      changeSetId,
      operationId: `op_${randomUUID()}`,
      logicalPath: entry.path,
      ...(beforeHash ? { beforeHash } : {}),
      afterHash: value.sha256,
      ...(snapshotPath ? { snapshotPath } : {}),
      metadata: existed
        ? { kind: 'write', via: 'files_download', recoverable }
        : { kind: 'create', via: 'files_download' },
    } as any);
  } catch {
    // The bytes are on disk; report the file as written but not rollback-able.
    return {
      path: entry.path,
      ok: true,
      bytes: value.bytes,
      sha256: value.sha256,
      mimeType: value.mimeType,
      mimeMismatch: Boolean(value.mimeMismatch),
      recoverable: false,
    };
  }
  return {
    path: entry.path,
    ok: true,
    bytes: value.bytes,
    sha256: value.sha256,
    mimeType: value.mimeType,
    mimeMismatch: Boolean(value.mimeMismatch),
    recoverable,
  };
}
