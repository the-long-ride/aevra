import {
  FILE_TRANSFER_SETTING_KEY,
  normalizeTransferLimits,
  transferLimitBytes,
} from '../../protocol/src/file-transfer.js';
import { classifySensitivity } from '../../security/src/sensitive.js';
import { Base64Accumulator } from './base64-stream.js';
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
import { isMissingCode, transferTimeoutMs } from './transfer-entries.js';
import { mimeFromPath } from './transfer-mime.js';

const CAPABILITY = 'files.read' as const;
const MAX_PATHS = 64;
/** R6: `auto` answers inline only while the whole result stays this small. */
const AUTO_INLINE_BYTES = 4 * 1024 * 1024;

type Delivery = 'auto' | 'inline' | 'link';
type Failure = { path: string; ok: false; error: { code: string; message: string } };
type Stat = { bytes: number; sha256: string; mimeType: string | null };

function invalid(message: string): never {
  throw new AevraToolError('INVALID_REQUEST', message);
}

function parseUploadArgs(args: any): { paths: string[]; delivery: Delivery } {
  const raw = args?.paths;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_PATHS) {
    invalid(`paths must contain 1 to ${MAX_PATHS} items`);
  }
  const seen = new Set<string>();
  for (const path of raw) {
    if (typeof path !== 'string' || !path.trim() || path.includes('\0')) {
      invalid('paths must be non-empty strings');
    }
    if (seen.has(path)) invalid(`Duplicate path in batch: ${path}`);
    seen.add(path);
  }
  const delivery = args?.delivery ?? 'auto';
  if (delivery !== 'auto' && delivery !== 'inline' && delivery !== 'link') {
    invalid('delivery must be auto, inline or link');
  }
  return { paths: raw, delivery };
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

/** A transfer may only read what file_read_many could: secret and protected paths are refused. */
function assertReadable(
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
        operation: 'read',
        logicalPath: path,
        mutation: false,
      }).decision
    : classifySensitivity({ path }) === 'NORMAL'
      ? 'allow'
      : 'deny';
  if (decision !== 'allow') {
    throw new AevraToolError(
      'CAPABILITY_REQUIRED',
      `Protected resource cannot be read by a transfer: ${path}`,
    );
  }
}

export async function handleFilesUpload(context: McpRuntimeContext, sessionId: string, args: any) {
  const { paths, delivery } = parseUploadArgs(args);
  assertTransferPermitted(context, sessionId, CAPABILITY);
  if (
    transferNeedsApproval(context, sessionId) &&
    !transferApproved(context, sessionId, CAPABILITY)
  ) {
    const entries = paths.map((path) => ({ path, source: 'inline' as const }));
    return requestTransferApproval(context, sessionId, {
      direction: 'upload',
      tool: 'files_upload',
      capability: CAPABILITY,
      args,
      storedArgs: { paths, delivery },
      entries,
      headersSupplied: 0,
    });
  }
  return runBatch(context, sessionId, paths, delivery);
}

async function runBatch(
  context: McpRuntimeContext,
  sessionId: string,
  paths: string[],
  delivery: Delivery,
) {
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
  const globField = globs ? { protectedGlobs: globs } : {};

  const stats = new Map<string, Stat>();
  const failures = new Map<string, Failure>();
  let batchBytes = 0;
  for (const path of paths) {
    try {
      assertReadable(context, sessionId, lease.workspaceId, path);
      const stat = await context.worker.execute({
        ...call,
        operation: { kind: 'files.upload.stat', path, ...globField },
      });
      if (!stat.ok) {
        failures.set(
          path,
          isMissingCode(stat.error.code)
            ? failure(path, 'NOT_FOUND', 'File not found')
            : failure(path, stat.error.code, stat.error.message),
        );
        continue;
      }
      const value = stat.value as Stat;
      if (value.bytes > limits.file) {
        failures.set(path, failure(path, 'SIZE_LIMIT', 'File exceeds the per-file limit'));
        continue;
      }
      if (batchBytes + value.bytes > limits.batch) {
        failures.set(path, failure(path, 'BATCH_LIMIT', 'Batch exceeds the per-batch limit'));
        continue;
      }
      batchBytes += value.bytes;
      stats.set(path, value);
    } catch (error) {
      failures.set(path, thrownFailure(path, error));
    }
  }

  const total = [...stats.values()].reduce((sum, stat) => sum + stat.bytes, 0);
  const mode: 'inline' | 'link' =
    delivery === 'auto'
      ? total <= Math.min(AUTO_INLINE_BYTES, limits.inline)
        ? 'inline'
        : 'link'
      : delivery;

  const identity = context.sessions.connectionIdentity(sessionId) as
    { connectionId?: string } | null | undefined;
  const connectionId = identity?.connectionId ?? sessionId;
  let inlineUsed = 0;
  const results: any[] = [];
  for (const path of paths) {
    const failed = failures.get(path);
    const stat = stats.get(path);
    if (failed || !stat) {
      results.push(failed!);
      continue;
    }
    try {
      const mimeType = stat.mimeType ?? mimeFromPath(path);
      if (mode === 'link') {
        const links = context.deps.transferLinks;
        if (!links?.canMint()) {
          results.push(failure(path, 'PUBLIC_URL_REQUIRED', 'Links need a configured public URL'));
          continue;
        }
        const link = links.mint({
          connectionId,
          sessionId,
          actor: session.actor,
          workspaceId: lease.workspaceId,
          path,
          sha256: stat.sha256,
          bytes: stat.bytes,
          mimeType,
          ...globField,
        });
        results.push({
          path,
          ok: true,
          mimeType,
          bytes: stat.bytes,
          sha256: stat.sha256,
          delivery: 'link',
          url: link.url,
          expiresAt: link.expiresAt,
        });
        continue;
      }
      if (inlineUsed + stat.bytes > limits.inline) {
        results.push(failure(path, 'INLINE_TOO_LARGE', 'Inline content exceeds the inline limit'));
        continue;
      }
      const read = await readInline(context, call, globField, path, stat);
      if (read.ok) inlineUsed += read.bytes;
      results.push(read.ok ? { ...read, mimeType } : read);
    } catch (error) {
      results.push(thrownFailure(path, error));
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  context.deps.audit?.append({
    actor: session.actor,
    sessionId,
    workspaceId: lease.workspaceId,
    tool: 'files_upload',
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

async function readInline(
  context: McpRuntimeContext,
  call: { sessionId: string; workspaceId: string; roots: any; executionMode: 'host' },
  globField: object,
  path: string,
  stat: Stat,
): Promise<
  | Failure
  | { path: string; ok: true; bytes: number; sha256: string; delivery: 'inline'; content: string }
> {
  if (!context.worker.executeWithDownload) {
    return failure(path, 'EXECUTOR_UNAVAILABLE', 'Worker cannot stream file content');
  }
  const { result, body } = await context.worker.executeWithDownload({
    ...call,
    operation: {
      kind: 'files.upload.read',
      path,
      sha256: stat.sha256,
      timeoutMs: transferTimeoutMs(stat.bytes),
      ...globField,
    },
  });
  const settled = result.then(
    (value) => value,
    (error) => ({
      ok: false as const,
      error: {
        code: typeof error?.code === 'string' ? error.code : 'EXECUTOR_UNAVAILABLE',
        message: error instanceof Error ? error.message : String(error),
      },
    }),
  );
  const encoder = new Base64Accumulator();
  let got = 0;
  try {
    for await (const chunk of body) {
      got += chunk.length;
      if (got > stat.bytes) throw new AevraToolError('FILE_CHANGED', 'File grew while reading');
      encoder.push(chunk);
    }
  } catch (error) {
    const final = await settled;
    if (!final.ok) return failure(path, final.error.code, final.error.message);
    return thrownFailure(path, error);
  }
  const final = await settled;
  if (!final.ok) return failure(path, final.error.code, final.error.message);
  const value = final.value as { bytes: number; sha256: string };
  if (got !== value.bytes) return failure(path, 'FILE_CHANGED', 'File changed while reading');
  return {
    path,
    ok: true,
    bytes: got,
    sha256: value.sha256,
    delivery: 'inline',
    content: encoder.finish(),
  };
}
