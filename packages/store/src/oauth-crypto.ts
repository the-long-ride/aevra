import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function secret(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function eqHash(left: string, right: string) {
  return (
    left.length === right.length &&
    timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
  );
}
