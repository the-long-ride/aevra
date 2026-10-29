import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { encodeFrame, FrameDecoder } from './framing.js';
import { handshakeMac } from './envelope.js';
import { socketLink } from './stream.js';
import { StreamTable } from './stream-table.js';
import {
  runDownload,
  runUpload,
  type DownloadHandle,
  type StreamCallOptions,
  type StreamHost,
} from './stream-client.js';
import type { OperationEnvelope, WorkerResult } from '../../protocol/src/worker.js';

export type { DownloadHandle, StreamCallOptions } from './stream-client.js';

/** Transport slack on top of whatever the operation itself is allowed to take. */
export const IPC_OVERHEAD_MS = 30_000;
/** Applies to operations that declare no bound of their own. */
export const IPC_DEFAULT_DEADLINE_MS = 120_000;
/** No request may hold a pending slot forever, whatever it asked for. */
export const IPC_MAX_DEADLINE_MS = 24 * 60 * 60_000 + IPC_OVERHEAD_MS;
const HANDSHAKE_TIMEOUT_MS = 10_000;

class WorkerTransportError extends Error {
  constructor(
    message: string,
    readonly code: 'WORKER_TIMEOUT' | 'WORKER_DISCONNECTED',
  ) {
    super(message);
    this.name = 'WorkerTransportError';
  }
}

/**
 * How long to wait for one operation's reply.
 *
 * This was a flat 10 seconds for every request, regardless of what the operation
 * was allowed to take. `shell_run` advertises a timeout of up to 24 hours and
 * `process.wait` defaults to 15 seconds, so any command past ten seconds came
 * back as `worker timeout` while the worker carried on running it, and
 * `process_wait` could never succeed at its own default. The transport deadline
 * now derives from the operation it carries, so it outlives the work. Chunked
 * transfers use the same bound for the whole stream.
 */
export function deadlineForEnvelope(envelope: OperationEnvelope): number {
  const operation = (envelope as { operation?: Record<string, unknown> } | undefined)?.operation;
  const command = operation?.command as { timeoutMs?: unknown } | undefined;
  const declared = Number(command?.timeoutMs ?? (operation?.timeoutMs as unknown) ?? NaN);
  const base = Number.isFinite(declared) && declared > 0 ? declared : IPC_DEFAULT_DEADLINE_MS;
  return Math.min(base + IPC_OVERHEAD_MS, IPC_MAX_DEADLINE_MS);
}

export interface WorkerClient {
  execute(envelope: OperationEnvelope, signal?: AbortSignal): Promise<WorkerResult>;
  executeWithUpload?(
    envelope: OperationEnvelope,
    source: AsyncIterable<Uint8Array>,
    options?: StreamCallOptions,
  ): Promise<WorkerResult>;
  executeWithDownload?(
    envelope: OperationEnvelope,
    options?: StreamCallOptions,
  ): Promise<DownloadHandle>;
  health(): Promise<{ ready: boolean; pid: number }>;
  close(): Promise<void>;
}

interface Pending {
  resolve(value: any): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export class SocketWorkerClient implements WorkerClient {
  private socket?: net.Socket;
  private connecting?: Promise<void>;
  private next = 0;
  private pending = new Map<string, Pending>();
  private streams = new StreamTable(socketLink(() => this.socket));
  private streamHost: StreamHost = {
    table: this.streams,
    start: (type, build, deadlineMs) => this.start(type, build, deadlineMs),
    reject: (requestId, error) => this.rejectPending(requestId, error),
  };
  constructor(
    private endpoint: string,
    private secret: Buffer,
    private daemonInstanceId: string,
  ) {}
  async connect() {
    // Concurrent callers must wait for the SAME handshake, not just for a
    // socket object to exist. Returning early here let a second request write
    // its frame before `ready` had been sent, and the server destroys a socket
    // that speaks out of turn.
    if (this.connecting) return this.connecting;
    if (this.socket) return;
    this.connecting = this.openSocket().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }
  private async openSocket() {
    const socket = net.createConnection(this.endpoint);
    this.socket = socket;
    const decoder = new FrameDecoder();
    let ready = false;
    let onReady: (() => void) | undefined;
    let onFailed: ((error: Error) => void) | undefined;
    socket.on('data', (c) => {
      for (const frame of decoder.push(c)) {
        const f = frame as any;
        if (f.type === 'helloAck') {
          const expected = handshakeMac(
            this.secret,
            this.daemonInstanceId,
            f.challengeA,
            f.challengeB,
          );
          if (expected !== f.mac) {
            socket.destroy(new Error('worker handshake failed'));
            continue;
          }
          socket.write(
            encodeFrame({
              type: 'ready',
              challengeB: f.challengeB,
              mac: handshakeMac(this.secret, this.daemonInstanceId, f.challengeB),
            }),
          );
          // The server has proven itself and our 'ready' is on the wire, so
          // requests written from here on cannot race ahead of the handshake.
          ready = true;
          onReady?.();
        } else if (typeof f.type === 'string' && f.type.startsWith('stream')) {
          // A peer that has not finished the handshake gets no say over streams.
          if (ready) this.streams.handle(f);
        } else if (f.requestId) {
          const pending = this.pending.get(f.requestId);
          if (!pending) continue;
          clearTimeout(pending.timer);
          this.pending.delete(f.requestId);
          pending.resolve(f);
        }
      }
    });
    // A socket that dies mid-flight must fail its callers rather than leave them
    // waiting out their full deadline.
    const fail = (error: Error) => {
      onFailed?.(error);
      this.streams.abortAll('WORKER_DISCONNECTED');
      this.settleAll(new WorkerTransportError(error.message, 'WORKER_DISCONNECTED'));
      if (this.socket === socket) this.socket = undefined;
    };
    socket.once('error', fail);
    socket.once('close', () => fail(new Error('worker connection closed')));

    await new Promise<void>((res, rej) => {
      // Resolving on a fixed 15ms timer meant the first request could be written
      // before the handshake completed, and the server destroys a socket that
      // speaks out of turn.
      const timer = setTimeout(
        () => rej(new WorkerTransportError('worker handshake timed out', 'WORKER_TIMEOUT')),
        HANDSHAKE_TIMEOUT_MS,
      );
      onReady = () => {
        clearTimeout(timer);
        res();
      };
      onFailed = (error) => {
        clearTimeout(timer);
        if (this.socket === socket) this.socket = undefined;
        socket.destroy();
        rej(error);
      };
      socket.once('connect', () => {
        const a = randomBytes(16).toString('hex');
        socket.write(
          encodeFrame({ type: 'hello', daemonInstanceId: this.daemonInstanceId, challengeA: a }),
        );
      });
    });
  }
  private settleAll(error: Error) {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(requestId);
      pending.reject(error);
    }
  }
  private rejectPending(requestId: string, error: Error) {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    pending.reject(error);
  }
  /** Registers the reply slot, then writes the frame built for that request id. */
  private async start(
    type: string,
    build: (requestId: string) => Record<string, unknown>,
    deadlineMs: number,
  ) {
    await this.connect();
    const requestId = `r${++this.next}`;
    const reply = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(requestId)) return;
        reject(
          new WorkerTransportError(
            `worker did not answer ${type} within ${deadlineMs}ms; the operation may still be running`,
            'WORKER_TIMEOUT',
          ),
        );
      }, deadlineMs);
      this.pending.set(requestId, { resolve, reject, timer });
    });
    this.socket!.write(encodeFrame({ type, requestId, ...build(requestId) }));
    return { requestId, reply };
  }
  private async rpc(type: string, payload: any, deadlineMs: number) {
    return (await this.start(type, () => payload, deadlineMs)).reply;
  }
  async execute(envelope: OperationEnvelope, signal?: AbortSignal): Promise<WorkerResult> {
    if (signal?.aborted) throw signal.reason;
    const r = await this.rpc('execute', { envelope }, deadlineForEnvelope(envelope));
    return r.result;
  }
  executeWithUpload(
    envelope: OperationEnvelope,
    source: AsyncIterable<Uint8Array>,
    options: StreamCallOptions = {},
  ): Promise<WorkerResult> {
    return runUpload(
      this.streamHost,
      envelope,
      source,
      options.deadlineMs ?? deadlineForEnvelope(envelope),
    );
  }
  executeWithDownload(
    envelope: OperationEnvelope,
    options: StreamCallOptions = {},
  ): Promise<DownloadHandle> {
    return runDownload(
      this.streamHost,
      envelope,
      options.deadlineMs ?? deadlineForEnvelope(envelope),
    );
  }
  async health() {
    const r = await this.rpc('health', {}, IPC_OVERHEAD_MS);
    return r.health;
  }
  async close() {
    const socket = this.socket;
    this.socket = undefined;
    // Callers waiting on this socket would otherwise hang until their own
    // deadline for a reply that can no longer arrive.
    this.streams.abortAll('WORKER_DISCONNECTED');
    this.settleAll(new WorkerTransportError('worker client closed', 'WORKER_DISCONNECTED'));
    socket?.destroy();
  }
}
