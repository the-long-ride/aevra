import { ChunkReceiver, ChunkSender, StreamError, type StreamLink } from './stream.js';

interface Entry {
  requestId: string;
  receiver?: ChunkReceiver;
  sender?: ChunkSender;
  opened: boolean;
  onAbort?: (error: StreamError) => void;
}

/**
 * Every live stream on one socket. A stream is bound to the single request that
 * opened it, so a frame for an unknown, finished or foreign stream is refused
 * rather than routed.
 */
export class StreamTable {
  private entries = new Map<string, Entry>();

  constructor(private link: StreamLink) {}

  has(streamId: string) {
    return this.entries.has(streamId);
  }

  receiver(
    streamId: string,
    requestId: string,
    onAbort?: (error: StreamError) => void,
  ): ChunkReceiver {
    const receiver = new ChunkReceiver((seq) =>
      this.link.write({ type: 'streamAck', streamId, seq }),
    );
    receiver.onCancel = () => this.abort(streamId, 'STREAM_CANCELLED');
    this.entries.set(streamId, { requestId, receiver, opened: false, onAbort });
    return receiver;
  }

  sender(streamId: string, requestId: string, onAbort?: (error: StreamError) => void): ChunkSender {
    const sender = new ChunkSender(this.link, streamId, requestId);
    this.entries.set(streamId, { requestId, sender, opened: false, onAbort });
    return sender;
  }

  /** Forget a stream that finished normally. */
  close(streamId: string) {
    this.entries.delete(streamId);
  }

  abort(streamId: string, code: string, notifyPeer = true) {
    const entry = this.entries.get(streamId);
    if (!entry) return;
    this.entries.delete(streamId);
    if (notifyPeer) this.link.write({ type: 'streamAbort', streamId, code });
    const error = new StreamError(code);
    entry.receiver?.fail(error);
    entry.sender?.fail(error);
    entry.onAbort?.(error);
  }

  /** The socket is gone: fail everything, tell nobody. */
  abortAll(code: string) {
    for (const id of [...this.entries.keys()]) this.abort(id, code, false);
  }

  handle(f: Record<string, unknown>) {
    const streamId = f.streamId;
    if (typeof streamId !== 'string') return;
    const entry = this.entries.get(streamId);
    if (!entry) {
      if (f.type === 'streamOpen' || f.type === 'streamData' || f.type === 'streamEnd')
        this.link.write({ type: 'streamAbort', streamId, code: 'STREAM_UNKNOWN' });
      return;
    }
    if (f.type === 'streamAbort') {
      this.abort(streamId, typeof f.code === 'string' ? f.code : 'STREAM_ABORTED', false);
      return;
    }
    if (f.type === 'streamAck') {
      entry.sender?.ack(f.seq);
      return;
    }
    const receiver = entry.receiver;
    try {
      if (!receiver) throw new StreamError('STREAM_PROTOCOL', 'wrong direction');
      if (f.type === 'streamOpen') {
        if (entry.opened || f.requestId !== entry.requestId)
          throw new StreamError('STREAM_PROTOCOL', 'bad open');
        entry.opened = true;
        receiver.onOpen?.();
      } else if (f.type === 'streamData') {
        if (!entry.opened) throw new StreamError('STREAM_PROTOCOL', 'data before open');
        receiver.push(f.seq, f.data);
      } else if (f.type === 'streamEnd') {
        if (!entry.opened) throw new StreamError('STREAM_PROTOCOL', 'end before open');
        receiver.end(f.bytes);
      }
    } catch (e) {
      this.abort(streamId, e instanceof StreamError ? e.code : 'STREAM_PROTOCOL');
    }
  }
}
