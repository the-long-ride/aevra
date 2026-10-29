import type { WorkerResult } from '../../protocol/src/worker.js';
import type { StreamTable } from './stream-table.js';
import { StreamError, streamErrorCode, type ChunkReceiver, type ChunkSender } from './stream.js';

/** The slice of the socket client that stream calls need. */
export interface StreamHost {
  table: StreamTable;
  start(
    type: string,
    build: (requestId: string) => Record<string, unknown>,
    deadlineMs: number,
  ): Promise<{ requestId: string; reply: Promise<any> }>;
  reject(requestId: string, error: Error): void;
}

export interface StreamCallOptions {
  /** Overrides the deadline derived from the envelope (mainly for tests). */
  deadlineMs?: number;
}

/**
 * `result` settles when the worker replies, which for a download is after the last
 * byte. `body` is live from the moment the worker opens the stream, so a caller
 * must drain it (or stop iterating, which cancels the stream) while `result` is
 * still pending.
 */
export interface DownloadHandle {
  result: Promise<WorkerResult>;
  body: AsyncIterable<Uint8Array>;
}

let streamCounter = 0;
const nextStreamId = (prefix: string) => `${prefix}${++streamCounter}`;

function replyResult(f: any): WorkerResult {
  if (f.error !== undefined) throw new Error(String(f.error));
  return f.result as WorkerResult;
}

export async function runUpload(
  host: StreamHost,
  envelope: unknown,
  source: AsyncIterable<Uint8Array>,
  deadlineMs: number,
): Promise<WorkerResult> {
  const streamId = nextStreamId('u');
  let tx!: ChunkSender;
  let reply: Promise<any>;
  try {
    ({ reply } = await host.start(
      'execute',
      (requestId) => {
        tx = host.table.sender(streamId, requestId, (e) => host.reject(requestId, e));
        return { envelope, stream: { id: streamId, direction: 'upload' } };
      },
      deadlineMs,
    ));
  } catch (e) {
    host.table.close(streamId);
    throw e;
  }
  void (async () => {
    try {
      for await (const chunk of source) await tx.send(chunk);
      await tx.end();
    } catch (e) {
      // No-op when the peer already aborted: the entry is gone by then.
      host.table.abort(streamId, streamErrorCode(e, 'STREAM_SOURCE_ERROR'));
    }
  })();
  try {
    return replyResult(await reply);
  } catch (e) {
    host.table.abort(streamId, streamErrorCode(e, 'STREAM_ABORTED'));
    throw e;
  } finally {
    // Stops a pump the worker no longer wants (early return) without a frame.
    host.table.abort(streamId, 'STREAM_CLOSED', false);
  }
}

export async function runDownload(
  host: StreamHost,
  envelope: unknown,
  deadlineMs: number,
): Promise<DownloadHandle> {
  const streamId = nextStreamId('d');
  let rx!: ChunkReceiver;
  let opened!: () => void;
  const openSignal = new Promise<void>((res) => {
    opened = res;
  });
  let reply: Promise<any>;
  try {
    ({ reply } = await host.start(
      'execute',
      (requestId) => {
        rx = host.table.receiver(streamId, requestId, (e) => host.reject(requestId, e));
        rx.onOpen = opened;
        return { envelope, stream: { id: streamId, direction: 'download' } };
      },
      deadlineMs,
    ));
  } catch (e) {
    host.table.close(streamId);
    throw e;
  }
  const result = reply.then(
    (f) => {
      try {
        const value = replyResult(f);
        if (!rx.ended) rx.fail(new StreamError('STREAM_INCOMPLETE'));
        return value;
      } catch (e) {
        // An error reply with no preceding abort must not leave a reader hanging.
        rx.fail(e as Error);
        throw e;
      } finally {
        host.table.close(streamId);
      }
    },
    (e) => {
      host.table.abort(streamId, streamErrorCode(e, 'STREAM_ABORTED'));
      throw e;
    },
  );
  // The caller may only look at `body`; a failure still surfaces through it.
  result.catch(() => {});
  await Promise.race([openSignal, result]);
  return { result, body: rx };
}
