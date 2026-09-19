import { createHash, timingSafeEqual } from 'node:crypto';

export const SUPPORTED_SCOPES = ['mcp', 'offline_access'] as const;

export function base64urlSha256(value: string) {
  return createHash('sha256').update(value).digest('base64url');
}

export function safeEqualText(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isLoopbackHost(hostname: string) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

export function validateRedirectUri(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('redirect_uri must be an absolute URL');
  }
  if (url.hash) throw new Error('redirect_uri must not contain a fragment');
  if (url.protocol === 'https:') return value;
  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return value;
  throw new Error('redirect_uri must use HTTPS or localhost HTTP');
}

export function normalizeScope(value: string | undefined) {
  const scopes = String(value ?? 'mcp')
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  if (!scopes.includes('mcp')) scopes.unshift('mcp');
  const unique = [...new Set(scopes)];
  const unsupported = unique.filter((scope) => !SUPPORTED_SCOPES.includes(scope as any));
  if (unsupported.length) throw new Error(`unsupported OAuth scope: ${unsupported.join(' ')}`);
  return unique.join(' ');
}

export function canonicalResource(value: string) {
  return value.trim().replace(/\/+$/, '');
}

export function resourceMatches(requested: string | undefined, expected: string): boolean {
  const wanted = canonicalResource(expected);
  const value = String(requested ?? '').trim();
  if (!value) return true;
  const actual = canonicalResource(value);
  if (actual === wanted) return true;
  return actual === wanted.replace(/\/mcp$/, '');
}

export function resolvedResource(requested: string | undefined, expected: string): string {
  if (!resourceMatches(requested, expected)) {
    throw new Error('resource does not match this MCP server');
  }
  return expected;
}

export function buildProtectedResourceMetadata(resource: string, issuer: string) {
  return {
    resource,
    authorization_servers: [issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: [...SUPPORTED_SCOPES],
  };
}

export function buildAuthorizationServerMetadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    scopes_supported: [...SUPPORTED_SCOPES],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
  };
}
