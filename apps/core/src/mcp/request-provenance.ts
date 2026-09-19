import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { VerifiedRemoteIdentity } from '../auth/cloudflare.js';
import { remoteIp } from './http-response.js';

export interface RequestProvenance {
  requestId: string;
  remoteIp?: string;
  userAgent?: string;
  connectionId?: string;
  connectionSubject?: string;
  actor?: string;
  origin?: string;
  forwardedFor?: string;
}

const storage = new AsyncLocalStorage<RequestProvenance>();

export function currentRequestProvenance(): RequestProvenance | undefined {
  return storage.getStore();
}

export function withRequestProvenance<T>(provenance: RequestProvenance, fn: () => T): T {
  return storage.run(provenance, fn);
}

export function extractRequestProvenance(
  req: IncomingMessage,
  identity?: VerifiedRemoteIdentity,
  trustForwardedClientIp = false,
): RequestProvenance {
  const ip = remoteIp(req, trustForwardedClientIp);
  const userAgent =
    typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  const forwardedFor =
    typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : undefined;
  const rawRequestId = req.headers['x-request-id'];
  const requestId =
    typeof rawRequestId === 'string' && rawRequestId.trim()
      ? rawRequestId.trim()
      : `req_${randomUUID()}`;

  return {
    requestId,
    remoteIp: ip,
    userAgent,
    connectionId: identity?.connectionId ?? identity?.subject,
    connectionSubject: identity?.subject,
    actor: identity?.actor,
    origin,
    forwardedFor,
  };
}
