import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CapabilityRoot } from '../../../../packages/protocol/src/index.js';
import type { WorkerResult } from '../../../../packages/protocol/src/worker.js';
import type { AuditEventInput } from '../audit/audit-service.js';
import type { LinkRecord, TransferLinkStore } from '../files/transfer-links.js';
import { transferTimeoutMs } from '../../../../packages/mcp-tools/src/transfer-entries.js';
import { bearerToken, remoteIp } from './http-response.js';

export interface FileLinkRouteDeps {
  links: TransferLinkStore;
  worker: {
    executeWithDownload?(input: any): Promise<{
      result: Promise<WorkerResult>;
      body: AsyncIterable<Uint8Array>;
    }>;
  };
  roots(workspaceId: string): CapabilityRoot[];
  /** True while the connection that minted the link is still active. */
  alive(connectionId: string): boolean;
  /** Resolves an optional bearer token to the connection it belongs to. */
  identify?(
    token: string,
    ip: string,
  ): Promise<{ connectionId?: string; actor?: string } | null | undefined>;
  audit?: { append(event: AuditEventInput): unknown };
  /** How long a client may leave a full socket buffer undrained; defaults to 60 s. */
  drainTimeoutMs?: number;
}

const DRAIN_TIMEOUT_MS = 60_000;

const SECRET_PATH = /^\/files\/([A-Za-z0-9_-]{16,128})$/;

/** One answer for unknown, expired, used and revoked links, so none can be told apart. */
function notFound(res: ServerResponse) {
  res.statusCode = 404;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end('Not Found');
}

function safeFilename(path: string) {
  const name = path.slice(path.lastIndexOf('/') + 1) || 'download';
  const cleaned = name.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120);
  return cleaned.trim() || 'download';
}

function safeMime(value: string) {
  return /^[A-Za-z0-9][\w.+-]*\/[A-Za-z0-9][\w.+-]*$/.test(value)
    ? value
    : 'application/octet-stream';
}

function waitForDrain(res: ServerResponse, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    if (res.destroyed || res.writableEnded) return reject(new Error('client closed'));
    const done = (error?: Error) => {
      clearTimeout(timer);
      res.off('close', onClose);
      res.off('drain', onDrain);
      if (error) reject(error);
      else resolve();
    };
    const onClose = () => done(new Error('client closed'));
    const onDrain = () => done();
    const timer = setTimeout(() => done(new Error('client stalled')), timeoutMs);
    res.once('close', onClose);
    res.once('drain', onDrain);
  });
}

/**
 * `GET /files/<secret>`: streams one file for a one-time link. The route claims the link
 * first (so a racing second request loses), re-checks that the minting connection is still
 * active, and only then asks the worker for the bytes. The secret and the url are never
 * logged or audited; the audit event carries the link id.
 */
export function createFileLinkRoute(deps: FileLinkRouteDeps) {
  return async function handleFileLink(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    trustForwardedClientIp = false,
  ): Promise<void> {
    const match = req.method === 'GET' ? SECRET_PATH.exec(url.pathname) : null;
    const record = match ? deps.links.claim(match[1]!) : null;
    if (!record) return notFound(res);
    try {
      await serve(deps, req, res, record, trustForwardedClientIp);
    } catch {
      deps.links.release(record.id);
      audit(deps, record, 'failed', 'worker failed');
      if (res.headersSent) res.destroy();
      else notFound(res);
    }
  };
}

async function serve(
  deps: FileLinkRouteDeps,
  req: IncomingMessage,
  res: ServerResponse,
  record: LinkRecord,
  trust: boolean,
) {
  if (!deps.alive(record.connectionId)) {
    deps.links.complete(record.id);
    audit(deps, record, 'failed', 'connection closed');
    return notFound(res);
  }
  const token = bearerToken(req);
  if (token !== undefined) {
    const who = await deps.identify?.(token, remoteIp(req, trust));
    const same =
      who &&
      (who.connectionId === record.connectionId || (who.actor && who.actor === record.actor));
    if (!same) {
      deps.links.release(record.id);
      audit(deps, record, 'failed', 'bearer mismatch');
      return notFound(res);
    }
  }
  if (!deps.worker.executeWithDownload) {
    deps.links.release(record.id);
    audit(deps, record, 'failed', 'worker unavailable');
    res.statusCode = 503;
    res.setHeader('cache-control', 'no-store');
    res.end('Unavailable');
    return;
  }
  const { result, body } = await deps.worker.executeWithDownload({
    sessionId: record.sessionId,
    workspaceId: record.workspaceId,
    roots: deps.roots(record.workspaceId),
    executionMode: 'host',
    operation: {
      kind: 'files.upload.read',
      path: record.path,
      sha256: record.sha256,
      timeoutMs: transferTimeoutMs(record.bytes),
      ...(record.protectedGlobs ? { protectedGlobs: record.protectedGlobs } : {}),
    },
  });
  const drainMs = deps.drainTimeoutMs ?? DRAIN_TIMEOUT_MS;
  const settled = result.then(
    (value) => value,
    () => null,
  );
  let started = false;
  let sent = 0;
  // The last chunk is held back until the worker confirms the file did not change, so a
  // changed file can never reach the client as a complete 200.
  let held: Uint8Array | null = null;
  const start = () => {
    started = true;
    res.statusCode = 200;
    res.setHeader('content-type', safeMime(record.mimeType));
    res.setHeader('content-length', String(record.bytes));
    res.setHeader('content-disposition', `attachment; filename="${safeFilename(record.path)}"`);
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
  };
  try {
    for await (const chunk of body) {
      if (!deps.links.isActive(record.id) || !deps.alive(record.connectionId)) {
        throw new Error('revoked');
      }
      if (!started) start();
      sent += chunk.length;
      if (sent > record.bytes) throw new Error('file grew');
      const previous = held;
      held = chunk;
      if (previous && !res.write(previous)) await waitForDrain(res, drainMs);
    }
  } catch (error) {
    await settled;
    const known = ['revoked', 'file grew', 'client closed', 'client stalled'];
    const message = error instanceof Error ? error.message : '';
    return abort(deps, res, record, started, known.includes(message) ? message : 'stream failed');
  }
  const final = await settled;
  if (!final?.ok) return abort(deps, res, record, started, 'worker failed');
  if (sent !== record.bytes) return abort(deps, res, record, started, 'size mismatch');
  if (res.destroyed) return abort(deps, res, record, started, 'client closed');
  if (!started) start();
  res.end(held ?? undefined);
  deps.links.complete(record.id);
  audit(deps, record, 'ok');
}

/** One audit event per claimed fetch; it carries the link id and a fixed reason, never the secret. */
function audit(deps: FileLinkRouteDeps, record: LinkRecord, outcome: 'ok' | 'failed', why = '') {
  deps.audit?.append({
    actor: record.actor,
    sessionId: record.sessionId,
    connectionId: record.connectionId,
    workspaceId: record.workspaceId,
    tool: 'files_upload',
    operation: 'files.link.fetch',
    risk: 'HIGH',
    result: `${outcome} link ${record.id}${why ? ` ${why}` : ''}`,
    redactionCount: 0,
  });
}

function abort(
  deps: FileLinkRouteDeps,
  res: ServerResponse,
  record: LinkRecord,
  started: boolean,
  why: string,
) {
  deps.links.release(record.id);
  audit(deps, record, 'failed', why);
  if (started || res.headersSent) res.destroy();
  else notFound(res);
}
