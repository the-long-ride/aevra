export const MAX_FRAME_BYTES = 1024 * 1024;
export function encodeFrame(value: unknown): Buffer {
  const json = JSON.stringify(value);
  const byteLength = Buffer.byteLength(json, 'utf8');
  if (byteLength > MAX_FRAME_BYTES) throw new Error('frame too large');
  const out = Buffer.allocUnsafe(4 + byteLength);
  out.writeUInt32BE(byteLength, 0);
  out.write(json, 4, byteLength, 'utf8');
  return out;
}
export class FrameDecoder {
  private chunks: Buffer[] = [];
  private buffered = 0;

  private peekLength(): number {
    if (this.chunks[0]!.length >= 4) return this.chunks[0]!.readUInt32BE(0);
    const merged = Buffer.concat(this.chunks, this.buffered);
    this.chunks = [merged];
    return merged.readUInt32BE(0);
  }

  push(chunk: Buffer): unknown[] {
    if (chunk.length > 0) {
      this.chunks.push(chunk);
      this.buffered += chunk.length;
    }
    if (this.buffered < 4) return [];
    const firstLen = this.peekLength();
    if (firstLen > MAX_FRAME_BYTES) throw new Error('frame too large');
    if (this.buffered < 4 + firstLen) return [];

    const buf =
      this.chunks.length === 1 ? this.chunks[0]! : Buffer.concat(this.chunks, this.buffered);
    const out: unknown[] = [];
    let offset = 0;
    while (buf.length - offset >= 4) {
      const n = buf.readUInt32BE(offset);
      if (n > MAX_FRAME_BYTES) throw new Error('frame too large');
      if (buf.length - offset < 4 + n) break;
      const raw = buf.toString('utf8', offset + 4, offset + 4 + n);
      offset += 4 + n;
      out.push(JSON.parse(raw));
    }
    if (offset === buf.length) {
      this.chunks = [];
      this.buffered = 0;
    } else {
      const tail = Buffer.from(buf.subarray(offset));
      this.chunks = [tail];
      this.buffered = tail.length;
    }
    return out;
  }
}
