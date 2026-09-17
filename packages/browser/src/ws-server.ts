import { createHash, randomBytes } from 'node:crypto';

export interface DecodedFrame {
  opcode: number;
  text: string;
}

export interface FrameRead {
  frames: DecodedFrame[];
  rest: Buffer;
}

export const WS_TEXT = 0x1;
export const WS_CLOSE = 0x8;

/**
 * Largest payload a single frame may declare.
 *
 * A 64-bit length header is 8 bytes the peer chooses, and the reader below
 * buffers until the declared payload actually arrives - so an unbounded length
 * is an unbounded allocation driven from the other end of the socket. Nothing
 * the extension sends comes close to this; a frame that claims more is a peer
 * misbehaving, and the caller drops the socket rather than waiting for bytes
 * that would never be legitimate.
 */
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;

export class WsFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WsFrameError';
  }
}

/** RFC 6455 server accept value for a client's `Sec-WebSocket-Key`. */
export function acceptKey(key: string): string {
  return createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
}

/**
 * Encodes one text frame. Servers send unmasked frames; a client must mask, so
 * `mask` is set only by the extension-side peer used in tests.
 */
export function encodeFrame(payload: string, mask = false): Buffer {
  const body = Buffer.from(payload, 'utf8');
  const header: number[] = [0x80 | WS_TEXT];
  const maskBit = mask ? 0x80 : 0;
  if (body.length < 126) {
    header.push(maskBit | body.length);
  } else if (body.length < 65536) {
    header.push(maskBit | 126, (body.length >> 8) & 0xff, body.length & 0xff);
  } else {
    header.push(maskBit | 127, 0, 0, 0, 0);
    header.push(
      (body.length >>> 24) & 0xff,
      (body.length >>> 16) & 0xff,
      (body.length >>> 8) & 0xff,
      body.length & 0xff,
    );
  }
  if (!mask) return Buffer.concat([Buffer.from(header), body]);
  const key = randomBytes(4);
  const masked = Buffer.from(body);
  for (let index = 0; index < masked.length; index += 1) {
    masked[index] ^= key[index % 4]!;
  }
  return Buffer.concat([Buffer.from(header), key, masked]);
}

/**
 * Decodes every *complete* frame in `buffer` and returns the undecoded
 * remainder. TCP splits frames across chunks, so a reader that assumed each
 * chunk held whole frames would drop commands under load.
 */
export function readFrames(buffer: Buffer): FrameRead {
  const frames: DecodedFrame[] = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const opcode = buffer[offset]! & 0x0f;
    const masked = (buffer[offset + 1]! & 0x80) !== 0;
    let length = buffer[offset + 1]! & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (cursor + 2 > buffer.length) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (cursor + 8 > buffer.length) break;
      length = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }
    // Checked before any buffering decision, so an oversized claim is refused
    // on the header rather than after the bytes have been accumulated.
    if (!Number.isFinite(length) || length > MAX_FRAME_BYTES) {
      throw new WsFrameError(`frame declares ${length} bytes, over the ${MAX_FRAME_BYTES} cap`);
    }
    if (masked && cursor + 4 > buffer.length) break;
    const key = masked ? buffer.subarray(cursor, cursor + 4) : Buffer.alloc(0);
    if (masked) cursor += 4;
    if (cursor + length > buffer.length) break;
    const payload = Buffer.from(buffer.subarray(cursor, cursor + length));
    if (masked) {
      for (let index = 0; index < payload.length; index += 1) payload[index] ^= key[index % 4]!;
    }
    frames.push({ opcode, text: payload.toString('utf8') });
    offset = cursor + length;
  }
  return { frames, rest: buffer.subarray(offset) };
}
