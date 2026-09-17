import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Duplex } from 'node:stream';
import { verifyExtensionToken } from '../../security/src/extension-token.js';
import {
  acceptKey,
  encodeFrame,
  MAX_FRAME_BYTES,
  readFrames,
  WS_CLOSE,
  WS_TEXT,
} from './ws-server.js';

export interface ExtensionServerOptions {
  secret: Buffer;
  extensionId: string;
  epoch: () => number;
  authTimeoutMs?: number;
}

export interface ExtensionAddress {
  host: string;
  port: number;
  url: string;
}

export type ExtensionEventListener = (name: string, payload: unknown) => void;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface Peer {
  id: string;
  socket: Duplex;
}

const DEFAULT_AUTH_TIMEOUT_MS = 3000;
const LOOPBACK = '127.0.0.1';

/**
 * Worker-side listener for the Aevra browser extension.
 *
 * MV3 service workers cannot set WebSocket request headers, so the credential
 * arrives as the first frame instead. Two checks guard the socket: the Origin
 * header must be exactly the paired extension, and the first frame must carry
 * a token that verifies at the current epoch.
 *
 * Only the SECOND of those is a wall. `Origin` is a header a browser sets and
 * refuses to let a page forge - it is not a header the operating system
 * enforces, and any local process can open this socket with
 * `Origin: chrome-extension://<paired id>` spelled out by hand. The paired id
 * is not secret either: it is in the unpacked extension on disk and in the
 * admin API's own pairing state. So the origin pin stops a WEB PAGE (which
 * cannot choose its origin) and nothing else; the MAC'd, epoch-bound token is
 * what actually stops another local process. Do not add a capability here on
 * the strength of the origin check alone.
 */
export class ExtensionServer {
  private server: Server | null = null;
  private current: Peer | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<ExtensionEventListener>();
  private nextId = 1;

  constructor(private readonly options: ExtensionServerOptions) {}

  async start(input: { port: number }): Promise<ExtensionAddress> {
    if (this.server) throw new Error('Extension server is already listening');
    const server = createServer();
    server.on('upgrade', (request, socket: Duplex) => {
      const origin = String(request.headers.origin ?? '');
      if (origin !== `chrome-extension://${this.options.extensionId}`) {
        socket.destroy();
        return;
      }
      const key = String(request.headers['sec-websocket-key'] ?? '');
      socket.write(
        [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${acceptKey(key)}`,
          '\r\n',
        ].join('\r\n'),
      );
      this.attach(socket);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(input.port, LOOPBACK, resolve);
    });
    this.server = server;
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : input.port;
    return { host: LOOPBACK, port, url: `ws://${LOOPBACK}:${port}` };
  }

  private attach(socket: Duplex): void {
    let authenticated = false;
    // Annotated: `Buffer.alloc` infers Buffer<ArrayBuffer>, but a decoded
    // remainder is Buffer<ArrayBufferLike> and would not assign back.
    let buffer: Buffer = Buffer.alloc(0);
    const timer = setTimeout(() => {
      if (!authenticated) socket.destroy();
    }, this.options.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS);
    timer.unref?.();

    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      clearTimeout(timer);
      if (this.current?.socket === socket) this.current = null;
    });
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      // A peer that never completes a frame would otherwise grow this buffer
      // without limit. The cap is one frame's worth plus the largest header,
      // so a legal frame still assembles across as many TCP chunks as it takes.
      if (buffer.length > MAX_FRAME_BYTES + 16) {
        socket.destroy();
        return;
      }
      let read;
      try {
        read = readFrames(buffer);
      } catch {
        socket.destroy();
        return;
      }
      buffer = read.rest;
      for (const frame of read.frames) {
        if (frame.opcode === WS_CLOSE) {
          socket.destroy();
          return;
        }
        if (frame.opcode !== WS_TEXT) continue;
        let message: any;
        try {
          message = JSON.parse(frame.text);
        } catch {
          socket.destroy();
          return;
        }
        if (!authenticated) {
          // One shot: the first frame either authenticates or the socket dies.
          // The peer is never told which check failed.
          if (message?.type !== 'auth' || !this.verify(String(message.token ?? ''))) {
            socket.destroy();
            return;
          }
          authenticated = true;
          clearTimeout(timer);
          this.adopt(socket);
          continue;
        }
        this.handle(message);
      }
    });
  }

  private verify(token: string): boolean {
    try {
      const claims = verifyExtensionToken(this.options.secret, token, {
        epoch: this.options.epoch(),
      });
      return claims.extensionId === this.options.extensionId;
    } catch {
      return false;
    }
  }

  private adopt(socket: Duplex): void {
    const previous = this.current;
    this.current = { id: `ext_${randomUUID()}`, socket };
    if (previous && previous.socket !== socket) previous.socket.destroy();
    for (const listener of this.listeners) listener('peer', { peerId: this.current.id });
  }

  private handle(message: any): void {
    if (message?.type === 'event') {
      for (const listener of this.listeners) listener(String(message.name ?? ''), message.payload);
      return;
    }
    const id = String(message?.id ?? '');
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (message.type === 'error') {
      const detail = message.payload ?? {};
      pending.reject(
        Object.assign(new Error(String(detail.message ?? 'extension command failed')), {
          code: String(detail.code ?? 'BROWSER_UNAVAILABLE'),
        }),
      );
      return;
    }
    pending.resolve(message.payload);
  }

  on(handler: ExtensionEventListener): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  peer(): string | null {
    return this.current?.id ?? null;
  }

  peerId(): string {
    return this.current?.id ?? '';
  }

  call(op: string, params: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<unknown> {
    const peer = this.current;
    if (!peer) {
      return Promise.reject(
        Object.assign(new Error('The Aevra extension is not connected'), {
          code: 'BROWSER_UNAVAILABLE',
        }),
      );
    }
    const id = String(this.nextId++);
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.send(peer.socket, { type: 'cancel', id });
        reject(
          Object.assign(new Error(`BROWSER_TIMEOUT: ${op} exceeded ${timeoutMs}ms`), {
            code: 'BROWSER_TIMEOUT',
          }),
        );
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.send(peer.socket, { id, type: 'cmd', op, params });
    });
  }

  private send(socket: Duplex, payload: unknown): void {
    if (!socket.destroyed) socket.write(encodeFrame(JSON.stringify(payload)));
  }

  async stop(): Promise<void> {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('BROWSER_NOT_CONNECTED: extension server stopped'));
    }
    this.pending.clear();
    this.current?.socket.destroy();
    this.current = null;
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
