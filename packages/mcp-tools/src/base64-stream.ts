/**
 * Incremental base64 encoder: output equals `Buffer.concat(chunks).toString('base64')`
 * while only the encoded text parts (plus a 0-2 byte remainder) are kept, not the raw bytes.
 */
export class Base64Accumulator {
  private readonly parts: string[] = [];
  private carry: Buffer = Buffer.alloc(0);

  push(chunk: Uint8Array): void {
    const data = this.carry.length
      ? Buffer.concat([this.carry, Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)])
      : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    const whole = data.length - (data.length % 3);
    if (whole > 0) this.parts.push(data.subarray(0, whole).toString('base64'));
    // Copy the tail: the caller may reuse the chunk's memory.
    this.carry = Buffer.from(data.subarray(whole));
  }

  finish(): string {
    if (this.carry.length) this.parts.push(this.carry.toString('base64'));
    this.carry = Buffer.alloc(0);
    return this.parts.join('');
  }
}
