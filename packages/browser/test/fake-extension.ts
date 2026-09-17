import { randomBytes } from 'node:crypto';
import { connect, type Socket } from 'node:net';
import { encodeFrame, readFrames, WS_TEXT } from '../src/ws-server.js';

export type CommandHandler = (command: { op: string; params: any }) => unknown | Promise<unknown>;

export interface FakeExtensionOptions {
  token?: string;
  skipAuth?: boolean;
}

/**
 * Stands in for the MV3 service worker: performs the client handshake, sends
 * the auth frame, and answers `cmd` frames from a handler the test supplies.
 */
export class FakeExtension {
  private handler: CommandHandler = () => undefined;
  private rawHandler: ((command: any) => unknown) | null = null;
  private closed = false;

  private constructor(private readonly socket: Socket) {
    socket.on('close', () => {
      this.closed = true;
    });
    socket.on('error', () => {
      this.closed = true;
    });
  }

  static async open(
    url: string,
    extensionId: string,
    options: FakeExtensionOptions = {},
  ): Promise<FakeExtension> {
    const target = new URL(url);
    const socket = connect({
      host: target.hostname,
      port: Number(target.port),
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });

    const key = randomBytes(16).toString('base64');
    socket.write(
      [
        'GET / HTTP/1.1',
        `Host: ${target.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        `Origin: chrome-extension://${extensionId}`,
        '\r\n',
      ].join('\r\n'),
    );

    const peer = new FakeExtension(socket);
    await peer.awaitHandshake();
    if (!options.skipAuth && options.token) {
      peer.send({ type: 'auth', token: options.token });
    }
    return peer;
  }

  private awaitHandshake(): Promise<void> {
    return new Promise<void>((resolve) => {
      let header = Buffer.alloc(0);
      const onData = (chunk: Buffer) => {
        header = Buffer.concat([header, chunk]);
        const end = header.indexOf('\r\n\r\n');
        if (end === -1) return;
        this.socket.off('data', onData);
        this.listen(header.subarray(end + 4));
        resolve();
      };
      this.socket.on('data', onData);
      // A rejected upgrade closes the socket instead of replying; the test then
      // asserts on `closed()` rather than hanging here.
      this.socket.once('close', () => resolve());
    });
  }

  private listen(initial: Buffer): void {
    let buffer = initial;
    const consume = () => {
      const read = readFrames(buffer);
      buffer = read.rest;
      for (const frame of read.frames) {
        if (frame.opcode !== WS_TEXT) continue;
        let message: any;
        try {
          message = JSON.parse(frame.text);
        } catch {
          continue;
        }
        if (message?.type !== 'cmd') continue;
        if (this.rawHandler) {
          const frame = this.rawHandler(message);
          if (frame !== undefined) this.send(frame);
          continue;
        }
        // Awaited: the real service worker answers from an injected script that
        // can take time (wait_for polls the page), so the fake must too.
        void Promise.resolve(
          this.handler({ op: String(message.op), params: message.params ?? {} }),
        ).then((payload) => {
          if (payload === undefined) return;
          this.send({ id: message.id, type: 'result', payload });
        });
      }
    };
    consume();
    this.socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      consume();
    });
  }

  onCommand(handler: CommandHandler): void {
    this.handler = handler;
  }

  /** Answers a command with a whole frame, so a test can send an error. */
  onCommandRaw(handler: (command: any) => unknown): void {
    this.rawHandler = handler;
  }

  /** Sends bytes that are deliberately not JSON. */
  sendRaw(text: string): void {
    if (!this.socket.destroyed) this.socket.write(encodeFrame(text, true));
  }

  send(payload: unknown): void {
    if (!this.socket.destroyed) this.socket.write(encodeFrame(JSON.stringify(payload), true));
  }

  async closedWithin(ms: number): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (this.closed) return true;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return this.closed;
  }

  destroy(): void {
    this.socket.destroy();
  }
}

export function connectFakeExtension(
  url: string,
  extensionId: string,
  options: FakeExtensionOptions = {},
): Promise<FakeExtension> {
  return FakeExtension.open(url, extensionId, options);
}
