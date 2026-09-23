import { createHmac, timingSafeEqual } from 'node:crypto';

export interface ExtensionTokenClaims {
  extensionId: string;
  epoch: number;
  issuedAt: string;
  expiresAt: string;
}

class ExtensionTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtensionTokenError';
  }
}

function canonical(claims: ExtensionTokenClaims): string {
  return JSON.stringify({
    epoch: claims.epoch,
    expiresAt: claims.expiresAt,
    extensionId: claims.extensionId,
    issuedAt: claims.issuedAt,
  });
}

function sign(secret: Buffer, claims: ExtensionTokenClaims): string {
  return createHmac('sha256', secret).update(canonical(claims)).digest('base64url');
}

export function mintExtensionToken(secret: Buffer, claims: ExtensionTokenClaims): string {
  const payload = Buffer.from(canonical(claims), 'utf8').toString('base64url');
  return `${payload}.${sign(secret, claims)}`;
}

/**
 * Verified entirely offline: the worker must decide whether a paired extension
 * may attach without reading core's store, and revocation works by bumping the
 * epoch rather than by consulting a list.
 */
export function verifyExtensionToken(
  secret: Buffer,
  token: string,
  options: { epoch: number; now?: Date },
): ExtensionTokenClaims {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 2) throw new ExtensionTokenError('malformed token');
  let claims: ExtensionTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8'));
  } catch {
    throw new ExtensionTokenError('malformed token');
  }
  if (
    typeof claims?.extensionId !== 'string' ||
    typeof claims?.epoch !== 'number' ||
    typeof claims?.issuedAt !== 'string' ||
    typeof claims?.expiresAt !== 'string'
  ) {
    throw new ExtensionTokenError('malformed token');
  }
  const expected = Buffer.from(sign(secret, claims));
  const claimed = Buffer.from(String(parts[1]));
  if (expected.length !== claimed.length || !timingSafeEqual(expected, claimed)) {
    throw new ExtensionTokenError('invalid token signature');
  }
  if (claims.epoch !== options.epoch) {
    throw new ExtensionTokenError('token revoked: epoch mismatch');
  }
  const now = (options.now ?? new Date()).getTime();
  if (!Number.isFinite(Date.parse(claims.expiresAt)) || Date.parse(claims.expiresAt) < now) {
    throw new ExtensionTokenError('expired token');
  }
  return claims;
}
