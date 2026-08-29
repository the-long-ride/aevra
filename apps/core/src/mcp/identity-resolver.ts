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
}

interface IdentityResolverOptions {
  verifier?: RemoteIdentityVerifier;
  connectors?: ConnectorAdmission;
  oauth?: AevraOAuthService;
  plainMcpEnabled?: boolean;
  /** Honor forwarded client-IP headers because a trusted proxy was declared. */
  trustForwardedClientIp?: boolean;
}

export async function resolveMcpIdentity(
  req: IncomingMessage,
  res: ServerResponse,
  connectorToken: string | undefined,
  options: IdentityResolverOptions,
): Promise<VerifiedRemoteIdentity | null> {
  if (connectorToken) {
    const outcome = await verifyConnector(
      options.connectors,
      connectorToken,
      req,
      options.trustForwardedClientIp,
    );
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
    const identity = await verifyBearerToken(token, req, options);
    if (identity) return identity;
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

async function verifyBearerToken(
  token: string,
  req: IncomingMessage,
  options: IdentityResolverOptions,
) {
  if (options.oauth) {
    try {
      return options.oauth.verifyAccessToken(token);
    } catch {
      // Fall through to static connector verification.
    }
  }
  const connector = await verifyConnector(
    options.connectors,
    token,
    req,
    options.trustForwardedClientIp,
  );
  return connector.kind === 'admitted' ? connector.identity : null;
}

async function verifyConnector(
  connectors: ConnectorAdmission | undefined,
  token: string,
  req: IncomingMessage,
  trustForwardedClientIp = false,
): Promise<ConnectorAdmissionOutcome> {
  if (!connectors) return { kind: 'denied' };
  return connectors.verify(token, remoteIp(req, trustForwardedClientIp));
}

function unauthorized(res: ServerResponse, oauth?: AevraOAuthService) {
  applyOAuthCors(res);
  if (oauth) {
    const metadata = `${oauth.issuer}/.well-known/oauth-protected-resource/mcp`;
    res.setHeader('www-authenticate', `Bearer resource_metadata="${metadata}", scope="mcp"`);
  }
  sendJson(res, 401, { error: 'unauthorized' });
}
