import type net from 'node:net';
import { encodeFrame } from './framing.js';

/** Raw bytes per data frame. Base64 + JSON keeps each frame well under MAX_FRAME_BYTES. */
export const STREAM_CHUNK_BYTES = 512 * 1024;
/** Chunks a sender may have in flight before the receiver has consumed one. */
const STREAM_WINDOW = 8;
const MAX_B64_LENGTH = Math.ceil(STREAM_CHUNK_BYTES / 3) * 4;

/** An aborted or protocol-violating stream; `code` is what both peers see. */
export class StreamError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'StreamError';
  }
}

export function streamErrorCode(error: unknown, fallback: string): string {
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' && code ? code : fallback;
}

/** How a stream writes frames to its socket and waits for it to drain. */
export interface StreamLink {
  write(frame: Record<string, unknown>): boolean;
  drain(): Promise<void>;
}

export function socketLink(getSocket: () => net.Socket | undefined): StreamLink {
  return {
    write(frame) {
      const socket = getSocket();
      if (!socket || socket.destroyed) return false;
      return socket.write(encodeFrame(frame));
    },
    drain() {
      const socket = getSocket();
      if (!socket || socket.destroyed || !socket.writableNeedDrain) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const done = () => {
          socket.off('drain', done);
          socket.off('close', done);
          resolve();
        };
        socket.once('drain', done);
        socket.once('close', done);
      });
    },
  };
}

/** Receiving end: validates chunks, buffers at most one window, acks on consume. */
export class ChunkReceiver implements AsyncIterable<Uint8Array> {
  onOpen?: () => void;
  onCancel?: () => void;
  private queue: Buffer[] = [];
  private nextSeq = 0;
  private taken = 0;
  private bytes = 0;
  private done = false;
  private error?: Error;
  private wake?: () => void;

  constructor(private ack: (seq: number) => void) {}

  get ended() {
    return this.done;
  }

  push(seq: unknown, data: unknown) {
    if (this.done) throw new StreamError('STREAM_PROTOCOL', 'data after end');
    if (seq !== this.nextSeq) throw new StreamError('STREAM_SEQUENCE');
    if (typeof data !== 'string' || data.length > MAX_B64_LENGTH)
      throw new StreamError('STREAM_CHUNK_TOO_LARGE');
    const chunk = Buffer.from(data, 'base64');
    if (chunk.length > STREAM_CHUNK_BYTES) throw new StreamError('STREAM_CHUNK_TOO_LARGE');
    if (chunk.toString('base64') !== data) throw new StreamError('STREAM_BAD_DATA');
    if (this.queue.length >= STREAM_WINDOW) throw new StreamError('STREAM_WINDOW');
    this.nextSeq++;
    this.bytes += chunk.length;
    this.queue.push(chunk);
    this.wake?.();
  }

  end(bytes: unknown) {
    if (this.done) throw new StreamError('STREAM_PROTOCOL', 'duplicate end');
    if (bytes !== this.bytes) throw new StreamError('STREAM_LENGTH_MISMATCH');
    this.done = true;
    this.wake?.();
  }

  /** A completed stream keeps its buffered bytes; anything else drops them. */
  fail(error: Error) {
    if (this.done || this.error) return;
    this.error = error;
    this.queue = [];
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
    try {
      for (;;) {
        if (this.error) throw this.error;
        const next = this.queue.shift();
        if (next) {
          this.ack(this.taken++);
          yield next;
          continue;
        }
        if (this.done) return;
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
      }
    } finally {
      if (!this.done && !this.error) this.onCancel?.();
    }
  }
}

/**
 * Sending end: splits to chunk size, honours the ack window and socket backpressure.
 *
 * `send` and `end` run through one promise chain, so overlapping calls neither
 * interleave their bytes nor race for the single window-wait slot, and `end` always
 * lands after every byte queued before it.
 */
export class ChunkSender {
  private seq = 0;
  private acked = 0;
  private bytes = 0;
  private opened = false;
  private error?: Error;
  private waiters = new Set<() => void>();
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private link: StreamLink,
    readonly streamId: string,
    private requestId: string,
  ) {}

  send(chunk: Uint8Array): Promise<void> {
    return this.enqueue(() => this.sendNow(chunk));
  }

  end(): Promise<void> {
    return this.enqueue(async () => {
      if (this.error) throw this.error;
      this.open();
      this.link.write({ type: 'streamEnd', streamId: this.streamId, bytes: this.bytes });
    });
  }

  ack(seq: unknown) {
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) return;
    this.acked = Math.max(this.acked, Math.min(seq + 1, this.seq));
    this.wakeAll();
  }

  fail(error: Error) {
    this.error ??= error;
    this.wakeAll();
  }

  private enqueue(run: () => Promise<void>): Promise<void> {
    const result = this.tail.then(run);
    this.tail = result.catch(() => {});
    return result;
  }

  private wakeAll() {
    for (const wake of [...this.waiters]) wake();
  }

  private open() {
    if (this.opened) return;
    this.opened = true;
    this.link.write({ type: 'streamOpen', streamId: this.streamId, requestId: this.requestId });
  }

  private async sendNow(chunk: Uint8Array) {
    if (this.error) throw this.error;
    this.open();
    for (let offset = 0; offset < chunk.length; offset += STREAM_CHUNK_BYTES) {
      while (!this.error && this.seq - this.acked >= STREAM_WINDOW) {
        await new Promise<void>((resolve) => {
          const wake = () => {
            this.waiters.delete(wake);
            resolve();
          };
          this.waiters.add(wake);
        });
      }
      if (this.error) throw this.error;
      const piece = chunk.subarray(offset, offset + STREAM_CHUNK_BYTES);
      this.bytes += piece.length;
      const flushed = this.link.write({
        type: 'streamData',
        streamId: this.streamId,
        seq: this.seq++,
        data: Buffer.from(piece.buffer, piece.byteOffset, piece.length).toString('base64'),
      });
      if (!flushed) await this.link.drain();
      if (this.error) throw this.error;
    }
  }
}
