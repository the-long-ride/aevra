export const MAX_FRAME_BYTES = 1024 * 1024;
export function encodeFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value));
  if (body.length > MAX_FRAME_BYTES) throw new Error('frame too large');
  const out = Buffer.allocUnsafe(4 + body.length);
  out.writeUInt32BE(body.length, 0);
  body.copy(out, 4);
  return out;
}
export class FrameDecoder {
  private buffer = Buffer.alloc(0);
  push(chunk: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const out = [];
    while (this.buffer.length >= 4) {
      const n = this.buffer.readUInt32BE(0);
      if (n > MAX_FRAME_BYTES) throw new Error('frame too large');
      if (this.buffer.length < 4 + n) break;
      const raw = this.buffer.subarray(4, 4 + n);
      this.buffer = this.buffer.subarray(4 + n);
      out.push(JSON.parse(raw.toString('utf8')));
    }
    return out;
  }
}
