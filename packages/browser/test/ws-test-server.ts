import { createServer, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { acceptKey, encodeFrame, readFrames, WS_CLOSE, WS_TEXT } from '../src/ws-server.js';

type Handler = (
  message: string,
  reply: (data: string) => void,
  push: (data: string) => void,
) => void;

/**
 * Minimal WebSocket server for protocol tests. It reuses the production frame
 * codec so there is exactly one implementation of the wire format in the repo.
 */
export class WebSocketServer {
  private constructor(
    private readonly server: Server,
    private readonly sockets: Set<Duplex>,
    readonly url: string,
  ) {}

  static async start(handler: Handler): Promise<WebSocketServer> {
    const server = createServer();
    const sockets = new Set<Duplex>();
    server.on('upgrade', (request, socket: Duplex) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => sockets.delete(socket));
      const accept = acceptKey(String(request.headers['sec-websocket-key'] ?? ''));
      socket.write(
        [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${accept}`,
          '\r\n',
        ].join('\r\n'),
      );
      const send = (data: string) => {
        if (!socket.destroyed) socket.write(encodeFrame(data));
      };
      // Annotated: Buffer.alloc infers Buffer<ArrayBuffer>, but a decoded
      // remainder is Buffer<ArrayBufferLike> and would not assign back.
      let buffer: Buffer = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        const read = readFrames(buffer);
        buffer = read.rest;
        for (const frame of read.frames) {
          if (frame.opcode === WS_CLOSE) {
            socket.destroy();
            return;
          }
          if (frame.opcode !== WS_TEXT) continue;
          try {
            handler(frame.text, send, send);
          } catch {
            // A malformed frame must not take the listener down mid-test.
          }
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return new WebSocketServer(server, sockets, `ws://127.0.0.1:${port}/devtools`);
  }

  /** Upgraded sockets are detached from the server, so close them explicitly. */
  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
