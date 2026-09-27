import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Duplex } from 'node:stream';
import type { BrowserExtensionPairing } from '../../protocol/src/browser.js';
import {
  activeExtensionProfile,
  pairingStillAllowed,
  rejectExtensionAuthentication,
  verifyExtensionPairing,
  type ActiveExtensionProfile,
  type ExtensionPairingAuthOptions,
  type ExtensionPeerIdentity,
} from './extension-pairing-auth.js';
import {
  acceptKey,
  encodeFrame,
  MAX_FRAME_BYTES,
  readFrames,
  WS_CONTINUATION,
  WS_CLOSE,
  WS_TEXT,
} from './ws-server.js';

export interface ExtensionServerOptions extends ExtensionPairingAuthOptions {
  /** Compatibility input for older single-profile worker callers. */
  authTimeoutMs?: number;
}

export interface ExtensionAddress {
  host: string;
  port: number;
  url: string;
}

export type ExtensionEventListener = (name: string, payload: unknown) => void;

interface Pending {
  op: string;
  vision: boolean;
  lastStage: string;
  startedAt: number;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  socket: Duplex;
}

interface Peer extends ExtensionPeerIdentity {
  id: string;
  socket: Duplex;
}

const DEFAULT_AUTH_TIMEOUT_MS = 3000;
const LOOPBACK = '127.0.0.1';
const CAPTURE_STAGES = [
  'capture_started',
  'capture_api_done',
  'encode_done',
  'reply_send_attempt',
] as const;
type CloseCause =
  | 'remote_close'
  | 'remote_error'
  | 'protocol_error'
  | 'oversized_frame'
  | 'pairing_revoked'
  | 'server_stop';

/**
 * Worker-side listener for the Aevra browser extension.
 *
 * MV3 service workers cannot set WebSocket request headers, so the credential
 * arrives as the first frame instead. Two checks guard the socket: the Origin
 * header must identify a Chromium extension, and the first frame must carry a
 * token that verifies at the current epoch and matches both that origin and
 * the paired extension.
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
  private readonly standby = new Map<Duplex, Peer>();
  private readonly pending = new Map<string, Pending>();
  private readonly closeCauses = new WeakMap<Duplex, CloseCause>();
  private readonly listeners = new Set<ExtensionEventListener>();
  private nextId = 1;

  constructor(private readonly options: ExtensionServerOptions) {}

  async start(input: { port: number }): Promise<ExtensionAddress> {
    if (this.server) throw new Error('Extension server is already listening');
    // A plain request is the extension asking whether anything listens before
    // it dials: Chrome logs a refused WebSocket as an uncatchable extension
    // error. 426 with no body says only that this is a WebSocket endpoint.
    const server = createServer((_request, response) => {
      response.writeHead(426, { Upgrade: 'websocket', Connection: 'close' });
      response.end();
    });
    server.on('upgrade', (request, socket: Duplex) => {
      const origin = String(request.headers.origin ?? '');
      const originExtensionId = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin)?.[1];
      if (!originExtensionId) {
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
      this.attach(socket, originExtensionId);
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

  private attach(socket: Duplex, originExtensionId: string): void {
    let authenticated = false;
    // Annotated: `Buffer.alloc` infers Buffer<ArrayBuffer>, but a decoded
    // remainder is Buffer<ArrayBufferLike> and would not assign back.
    let buffer: Buffer = Buffer.alloc(0);
    let fragments: Buffer[] | null = null;
    let fragmentedBytes = 0;
    const timer = setTimeout(() => {
      if (!authenticated) socket.destroy();
    }, this.options.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS);
    timer.unref?.();

    socket.on('error', () => {
      this.markClose(socket, 'remote_error');
      socket.destroy();
    });
    // Node's HTTP server keeps upgraded sockets half-open, so a peer's FIN
    // arrives as `end` and `close` never follows on its own.
    socket.on('end', () => {
      this.markClose(socket, 'remote_close');
      socket.destroy();
    });
    socket.on('close', () => {
      clearTimeout(timer);
      this.standby.delete(socket);
      if (this.current?.socket === socket) {
        this.current = null;
        this.promoteStandby();
      }
      // A reply can no longer arrive on a dead socket. Waiting out the RPC
      // budget anyway is how a dropped socket used to surface as a timeout.
      this.failPending(
        socket,
        'BROWSER_UNAVAILABLE',
        'The Aevra extension disconnected before replying',
        this.closeCauses.get(socket) ?? 'remote_close',
      );
    });
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      let read;
      try {
        read = readFrames(buffer);
      } catch {
        this.dropOversized(socket);
        return;
      }
      buffer = read.rest;
      // Cap only the unfinished frame. A single TCP chunk may contain several
      // complete legal frames, including progress followed by a large reply.
      if (buffer.length > MAX_FRAME_BYTES + 16) {
        this.dropOversized(socket);
        return;
      }
      for (const frame of read.frames) {
        if (frame.opcode === WS_CLOSE) {
          this.markClose(socket, 'remote_close');
          socket.destroy();
          return;
        }
        let payload: Buffer;
        if (frame.opcode === WS_TEXT) {
          if (fragments) {
            this.markClose(socket, 'protocol_error');
            socket.destroy();
            return;
          }
          if (!frame.fin) {
            fragments = [frame.payload];
            fragmentedBytes = frame.payload.length;
            continue;
          }
          payload = frame.payload;
        } else if (frame.opcode === WS_CONTINUATION) {
          if (!fragments) {
            this.markClose(socket, 'protocol_error');
            socket.destroy();
            return;
          }
          fragmentedBytes += frame.payload.length;
          if (fragmentedBytes > MAX_FRAME_BYTES) {
            this.dropOversized(socket);
            return;
          }
          fragments.push(frame.payload);
          if (!frame.fin) continue;
          payload = Buffer.concat(fragments, fragmentedBytes);
          fragments = null;
          fragmentedBytes = 0;
        } else {
          // Control frames may appear between fragments.
          continue;
        }
        let message: any;
        try {
          message = JSON.parse(payload.toString('utf8'));
        } catch {
          this.markClose(socket, 'protocol_error');
          socket.destroy();
          return;
        }
        if (!authenticated) {
          // One shot: the first frame either authenticates or the socket dies.
          // The peer is never told which check failed.
          const pairing =
            message?.type === 'auth'
              ? verifyExtensionPairing(
                  this.options,
                  String(message.token ?? ''),
                  originExtensionId,
                  typeof message.profileId === 'string' ? message.profileId : undefined,
                )
              : null;
          if (!pairing) {
            rejectExtensionAuthentication(socket);
            return;
          }
          authenticated = true;
          clearTimeout(timer);
          const profileName =
            typeof message.profileName === 'string' && message.profileName.trim()
              ? message.profileName.trim().slice(0, 120)
              : pairing.profileName;
          this.adopt(socket, pairing, profileName);
          continue;
        }
        this.handle(message, socket);
      }
    });
  }

  /**
   * The only frame `readFrames` refuses is one over the cap, and from an
   * authenticated peer that is a reply too large to carry - a screenshot, in
   * practice. Saying so, before the close handler's generic reason, is what
   * turns an unexplained timeout into an actionable error.
   */
  private dropOversized(socket: Duplex): void {
    this.markClose(socket, 'oversized_frame');
    this.failPending(
      socket,
      'BROWSER_REPLY_TOO_LARGE',
      `The extension reply exceeded the ${MAX_FRAME_BYTES}-byte frame limit`,
      'oversized_frame',
    );
    socket.destroy();
  }

  private markClose(socket: Duplex, cause: CloseCause): void {
    if (!this.closeCauses.has(socket)) this.closeCauses.set(socket, cause);
  }

  private failPending(socket: Duplex, code: string, message: string, cause?: CloseCause): void {
    for (const [id, pending] of this.pending) {
      if (pending.socket !== socket) continue;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      const context =
        pending.op === 'snapshot' && cause ? ` (close=${cause}, stage=${pending.lastStage})` : '';
      pending.reject(Object.assign(new Error(`${code}: ${message}${context}`), { code }));
    }
  }

  private adopt(socket: Duplex, pairing: BrowserExtensionPairing, profileName: string): void {
    const previous = this.current;
    const peer: Peer = {
      id: `ext_${randomUUID()}`,
      socket,
      pairingId: pairing.pairingId,
      profileId: pairing.profileId,
      profileName,
      extensionId: pairing.extensionId,
      credentialId: pairing.credentialId,
    };
    if (previous && previous.socket !== socket) {
      this.standby.set(socket, peer);
      this.send(socket, { type: 'auth_standby' });
      return;
    }
    this.current = peer;
    this.send(socket, { type: 'auth_ok' });
    for (const listener of this.listeners) listener('peer', this.activeProfile());
  }

  private promoteStandby(): void {
    const next = this.standby.values().next().value as Peer | undefined;
    if (!next) return;
    this.standby.delete(next.socket);
    this.current = next;
    this.send(next.socket, { type: 'auth_ok' });
    for (const listener of this.listeners) listener('peer', this.activeProfile());
  }

  activeProfile(): ActiveExtensionProfile | null {
    return activeExtensionProfile(this.current);
  }

  activePairingStillAllowed(pairings: BrowserExtensionPairing[]): boolean {
    return pairingStillAllowed(this.current, pairings);
  }

  dropPeer(): void {
    const current = this.current;
    this.current = null;
    if (current) {
      this.markClose(current.socket, 'server_stop');
      current.socket.destroy();
    }
    for (const peer of this.standby.values()) {
      this.markClose(peer.socket, 'server_stop');
      peer.socket.destroy();
    }
    this.standby.clear();
  }

  pruneStandby(pairings: BrowserExtensionPairing[]): void {
    for (const peer of this.standby.values()) {
      if (pairingStillAllowed(peer, pairings)) continue;
      this.standby.delete(peer.socket);
      this.markClose(peer.socket, 'pairing_revoked');
      this.send(peer.socket, { type: 'auth_error', code: 'AUTH_REJECTED' });
      peer.socket.end();
    }
  }

  rejectPeer(): void {
    const current = this.current;
    this.current = null;
    if (!current) return;
    this.markClose(current.socket, 'pairing_revoked');
    this.failPending(
      current.socket,
      'BROWSER_UNAVAILABLE',
      'The browser profile pairing was revoked',
      'pairing_revoked',
    );
    if (current.socket.destroyed) return;
    this.send(current.socket, { type: 'auth_error', code: 'AUTH_REJECTED' });
    current.socket.end();
    this.promoteStandby();
  }

  private handle(message: any, socket: Duplex): void {
    if (this.current?.socket !== socket) return;
    if (message?.type === 'event') {
      for (const listener of this.listeners) listener(String(message.name ?? ''), message.payload);
      return;
    }
    const id = String(message?.id ?? '');
    const pending = this.pending.get(id);
    if (!pending || pending.socket !== socket) return;
    if (message.type === 'capture_progress') {
      if (!pending.vision) return;
      const stage = CAPTURE_STAGES.indexOf(message.stage);
      const previous = CAPTURE_STAGES.indexOf(pending.lastStage as (typeof CAPTURE_STAGES)[number]);
      if (
        stage < 0 ||
        stage <= previous ||
        !Number.isInteger(message.elapsedMs) ||
        message.elapsedMs < 0 ||
        message.elapsedMs > 120_000 ||
        (message.bytes !== undefined &&
          (!Number.isInteger(message.bytes) || message.bytes < 0 || message.bytes > 1_000_000_000))
      )
        return;
      pending.lastStage = message.stage;
      return;
    }
    if (message.type !== 'result' && message.type !== 'error') return;
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

  call(
    op: string,
    params: Record<string, unknown> = {},
    timeoutMs = 15_000,
    expectedPeerId?: string,
  ): Promise<unknown> {
    const peer = this.current;
    if (!peer || (expectedPeerId && peer.id !== expectedPeerId)) {
      return Promise.reject(
        Object.assign(
          new Error(
            peer
              ? 'The attached Aevra browser profile changed'
              : 'The Aevra extension is not connected',
          ),
          {
            code: expectedPeerId ? 'BROWSER_NOT_CONNECTED' : 'BROWSER_UNAVAILABLE',
          },
        ),
      );
    }
    const id = String(this.nextId++);
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        this.pending.delete(id);
        this.send(peer.socket, { type: 'cancel', id });
        const context = pending?.vision ? ` (stage=${pending.lastStage})` : '';
        reject(
          Object.assign(new Error(`BROWSER_TIMEOUT: ${op} exceeded ${timeoutMs}ms${context}`), {
            code: 'BROWSER_TIMEOUT',
          }),
        );
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, {
        op,
        vision: op === 'snapshot' && params.mode === 'vision',
        lastStage: 'command_sent',
        startedAt: Date.now(),
        resolve,
        reject,
        timer,
        socket: peer.socket,
      });
      this.send(peer.socket, { id, type: 'cmd', op, params });
    });
  }

  private send(socket: Duplex, payload: unknown): void {
    if (!socket.destroyed) socket.write(encodeFrame(JSON.stringify(payload)));
  }

  async stop(): Promise<void> {
    if (this.current) {
      this.failPending(
        this.current.socket,
        'BROWSER_NOT_CONNECTED',
        'extension server stopped',
        'server_stop',
      );
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      const context =
        pending.op === 'snapshot' ? ` (close=server_stop, stage=${pending.lastStage})` : '';
      pending.reject(
        Object.assign(new Error(`BROWSER_NOT_CONNECTED: extension server stopped${context}`), {
          code: 'BROWSER_NOT_CONNECTED',
        }),
      );
    }
    this.pending.clear();
    this.dropPeer();
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
