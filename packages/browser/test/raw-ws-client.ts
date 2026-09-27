import { connect, type Socket } from 'node:net';
import { mintExtensionToken } from '../../security/src/extension-token.js';
import { encodeFrame, readFrames, WS_TEXT } from '../src/ws-server.js';

/** Plain words, not key material: the HMAC accepts any byte string. */
export const SAMPLE_SECRET = Buffer.from('sample value used only by browser branch tests');
export const SAMPLE_EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';

export function sampleToken(epoch = 1): string {
  return mintExtensionToken(SAMPLE_SECRET, {
    extensionId: SAMPLE_EXTENSION_ID,
    epoch,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
}

export interface RawClient {
  socket: Socket;
  /** The HTTP response head, or '' when the server dropped the upgrade. */
  head: string;
  messages: any[];
  isClosed(): boolean;
  send(payload: unknown): void;
  /** Writes one masked frame whose first byte (FIN + opcode) is `byte0`. */
  frame(byte0: number, text: string): void;
}

/**
 * A WebSocket client that, unlike the fake extension, lets a test choose the
 * upgrade headers and the raw opcode/FIN bits of every frame it sends.
 */
export async function openRaw(port: number, headers: string[]): Promise<RawClient> {
  const socket = connect({ host: '127.0.0.1', port });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  let closed = false;
  socket.on('close', () => {
    closed = true;
  });
  socket.on('error', () => {
    closed = true;
  });
  const messages: any[] = [];
  let head = '';
  socket.write(
    [
      'GET / HTTP/1.1',
      `Host: 127.0.0.1:${port}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Version: 13',
      ...headers,
      '\r\n',
    ].join('\r\n'),
  );
  await new Promise<void>((resolve) => {
    let buffer: Buffer = Buffer.alloc(0);
    let upgraded = false;
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const end = buffer.indexOf('\r\n\r\n');
        if (end === -1) return;
        head = buffer.subarray(0, end).toString('latin1');
        buffer = buffer.subarray(end + 4);
        upgraded = true;
        resolve();
      }
      const read = readFrames(buffer);
      buffer = read.rest;
      for (const frame of read.frames) {
        if (frame.opcode === WS_TEXT) messages.push(JSON.parse(frame.text));
      }
    });
    socket.once('close', () => resolve());
  });
  return {
    socket,
    get head() {
      return head;
    },
    messages,
    isClosed: () => closed,
    send(payload) {
      if (!socket.destroyed) socket.write(encodeFrame(JSON.stringify(payload), true));
    },
    frame(byte0, text) {
      const bytes = encodeFrame(text, true);
      bytes[0] = byte0;
      if (!socket.destroyed) socket.write(bytes);
    },
  };
}

export const ORIGIN = `Origin: chrome-extension://${SAMPLE_EXTENSION_ID}`;
export const KEY = 'Sec-WebSocket-Key: c2FtcGxlIHZhbHVlIGtleQ==';

export async function until(condition: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
