import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  RejectingIdentityVerifier,
  type RemoteIdentityVerifier,
  type VerifiedRemoteIdentity,
} from '../auth/cloudflare.js';
import type { AevraOAuthService } from '../auth/oauth.js';
import { applyOAuthCors, bearerToken, remoteIp, sendJson } from './http-response.js';

export type ConnectorAdmissionOutcome =
  | { kind: 'admitted'; identity: VerifiedRemoteIdentity }
  | { kind: 'denied' }
  | { kind: 'rate-limited' };

export interface ConnectorAdmission {
  verify(token: string, ip: string): Promise<ConnectorAdmissionOutcome>;
  lookup?(token: string): boolean;
}

export interface InvalidBearerLimiter {
  allow(ip: string): boolean;
  retryAfterSeconds(ip: string): number;
}

export interface ConnectionTrafficLimiter {
  allow(connectionId: string): boolean;
  retryAfterSeconds(connectionId: string): number;
}

interface IdentityResolverOptions {
  verifier?: RemoteIdentityVerifier;
  connectors?: ConnectorAdmission;
  oauth?: AevraOAuthService;
  plainMcpEnabled?: boolean;
  /** Honor forwarded client-IP headers because a trusted proxy was declared. */
  trustForwardedClientIp?: boolean;
  invalidBearerLimiter?: InvalidBearerLimiter;
  connectionLimiter?: ConnectionTrafficLimiter;
}

export async function resolveMcpIdentity(
  req: IncomingMessage,
  res: ServerResponse,
  connectorToken: string | undefined,
  options: IdentityResolverOptions,
): Promise<VerifiedRemoteIdentity | null> {
  const ip = remoteIp(req, options.trustForwardedClientIp);

  if (connectorToken) {
    const outcome = await verifyConnector(options.connectors, connectorToken, ip);
    if (outcome.kind === 'rate-limited') {
      sendJson(res, 429, { error: 'rate_limited' });
      return null;
    }
    if (outcome.kind === 'admitted') return outcome.identity;
    unauthorized(res, options.oauth);
    return null;
  }

  const token = bearerToken(req);
  if (token) {
    // 1. Valid OAuth token?
    if (options.oauth) {
      try {
        const identity = options.oauth.verifyAccessToken(token, ip);
        if (identity) {
          if (options.connectionLimiter && identity.connectionId) {
            if (!options.connectionLimiter.allow(identity.connectionId)) {
              const retryAfter = options.connectionLimiter.retryAfterSeconds(identity.connectionId);
              res.setHeader('retry-after', String(retryAfter));
              sendJson(res, 429, { error: 'rate_limited' });
              return null;
            }
          }
          return identity;
        }
      } catch {
        // Fall through to connector lookup or invalid bearer handling.
      }
    }

    // 2. Known static connector token?
    const hasLookup = typeof options.connectors?.lookup === 'function';
    if (hasLookup ? options.connectors!.lookup!(token) : Boolean(options.connectors)) {
      const outcome = await verifyConnector(options.connectors, token, ip);
      if (outcome.kind === 'rate-limited') {
        sendJson(res, 429, { error: 'rate_limited' });
        return null;
      }
      if (outcome.kind === 'admitted') return outcome.identity;
      if (hasLookup) {
        unauthorized(res, options.oauth);
        return null;
      }
    }

    // 3. Unknown bearer token -> independent invalid bearer limiter
    if (options.invalidBearerLimiter) {
      if (!options.invalidBearerLimiter.allow(ip)) {
        const retryAfter = options.invalidBearerLimiter.retryAfterSeconds(ip);
        res.setHeader('retry-after', String(retryAfter));
        sendJson(res, 429, { error: 'rate_limited' });
        return null;
      }
    }

    unauthorized(res, options.oauth);
    return null;
  }

  if (options.plainMcpEnabled === false) {
    unauthorized(res, options.oauth);
    return null;
  }

  try {
    return await (options.verifier ?? new RejectingIdentityVerifier()).verifyRequest(req);
  } catch {
    unauthorized(res, options.oauth);
    return null;
  }
}

async function verifyConnector(
  connectors: ConnectorAdmission | undefined,
  token: string,
  ip: string,
): Promise<ConnectorAdmissionOutcome> {
  if (!connectors) return { kind: 'denied' };
  return connectors.verify(token, ip);
}

function unauthorized(res: ServerResponse, oauth?: AevraOAuthService) {
  applyOAuthCors(res);
  if (oauth) {
    const metadata = `${oauth.issuer}/.well-known/oauth-protected-resource/mcp`;
    res.setHeader(
      'www-authenticate',
      `Bearer error="invalid_token", resource_metadata="${metadata}", scope="mcp offline_access"`,
    );
  }
  sendJson(res, 401, { error: 'unauthorized' });
}
