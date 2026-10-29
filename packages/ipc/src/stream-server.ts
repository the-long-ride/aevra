import { StreamTable } from './stream-table.js';
import { streamErrorCode } from './stream.js';

/** What the worker handler sees for a stream-carrying execute. */
export interface StreamContext {
  /** Bytes the core is sending (files_upload direction into the worker). */
  upload?: AsyncIterable<Uint8Array>;
  /** Push bytes back to the core; resolves when the window allows more. */
  download?: (chunk: Uint8Array) => Promise<void>;
}

export interface ServerStream {
  ctx: StreamContext;
  /** Call just before the reply is written; resolves once the stream is settled. */
  beforeReply(error?: unknown): Promise<void>;
  /** Call just after the reply is written. */
  afterReply(): void;
}

/** Binds a stream to one request, or returns undefined when the descriptor is unusable. */
export function attachStream(
  table: StreamTable,
  requestId: string,
  meta: unknown,
): ServerStream | undefined {
  const m = meta as { id?: unknown; direction?: unknown } | undefined;
  if (!m || typeof m.id !== 'string' || !m.id || m.id.length > 64) return undefined;
  if (m.direction !== 'upload' && m.direction !== 'download') return undefined;
  const id = m.id;
  if (table.has(id)) return undefined;
  if (m.direction === 'upload') {
    const rx = table.receiver(id, requestId);
    // A handler that throws out of its read loop must report ITS error code, not a
    // generic cancel; the reply path below closes the stream either way.
    rx.onCancel = undefined;
    return {
      ctx: { upload: rx },
      async beforeReply(error) {
        if (error) table.abort(id, streamErrorCode(error, 'STREAM_HANDLER_ERROR'));
      },
      afterReply() {
        if (table.has(id) && !rx.ended) table.abort(id, 'STREAM_CLOSED');
        table.close(id);
      },
    };
  }
  const tx = table.sender(id, requestId);
  return {
    ctx: { download: (chunk) => tx.send(chunk) },
    async beforeReply(error) {
      if (error) {
        table.abort(id, streamErrorCode(error, 'STREAM_HANDLER_ERROR'));
        return;
      }
      if (!table.has(id)) return;
      // Queued behind any chunk the handler did not await, so the end frame never
      // overtakes bytes. A stream aborted meanwhile has already told the peer.
      await tx.end().catch(() => {});
    },
    afterReply() {
      table.close(id);
    },
  };
}
