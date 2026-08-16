import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import type { OperationEnvelope, VerifiedEnvelope } from '../../protocol/src/worker.js';
function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => (item === undefined ? 'null' : canonical(item))).join(',')}]`;
  const r = value as Record<string, unknown>;
  return `{${Object.keys(r)
    .filter((k) => r[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(r[k])}`)
    .join(',')}}`;
}
function mac(secret: Buffer, value: unknown) {
  return createHmac('sha256', secret).update(canonical(value)).digest('base64url');
}
export function randomIpcSecret() {
  return randomBytes(32);
}
export interface EnvelopeSigner {
  sign(input: Omit<OperationEnvelope, 'mac'>): OperationEnvelope;
  verify(envelope: OperationEnvelope, now?: Date): VerifiedEnvelope;
}
export class HmacEnvelopeSigner implements EnvelopeSigner {
  private seen = new Map<string, number>();
  constructor(
    private secret: Buffer,
    private daemonInstanceId: string,
    private maxClockSkewMs = 30_000,
  ) {}
  sign(input: Omit<OperationEnvelope, 'mac'>): OperationEnvelope {
    if (input.daemonInstanceId !== this.daemonInstanceId) throw new Error('wrong daemon instance');
    return { ...input, mac: mac(this.secret, input) };
  }
  verify(envelope: OperationEnvelope, now = new Date()): VerifiedEnvelope {
    const { mac: claimed, ...body } = envelope;
    const expected = mac(this.secret, body);
    const a = Buffer.from(claimed),
      b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('invalid envelope mac');
    if (envelope.daemonInstanceId !== this.daemonInstanceId)
      throw new Error('wrong daemon instance');
    const issued = Date.parse(envelope.issuedAt),
      expires = Date.parse(envelope.expiresAt),
      t = now.getTime();
    if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires < t)
      throw new Error('expired envelope');
    if (issued > t + this.maxClockSkewMs) throw new Error('future-issued envelope');
    this.prune(t);
    if (this.seen.has(envelope.nonce)) throw new Error('replay nonce');
    this.seen.set(envelope.nonce, expires);
    return { ...envelope, verifiedAt: now.toISOString() };
  }
  private prune(now: number) {
    for (const [n, e] of this.seen) if (e < now) this.seen.delete(n);
  }
}
export function handshakeMac(secret: Buffer, ...parts: string[]) {
  return createHmac('sha256', secret).update(parts.join('\0')).digest('base64url');
}
