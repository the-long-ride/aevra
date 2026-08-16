import type {
  OAuthAuthorizationRequestRecord,
  OAuthClientRecord,
  OAuthRepository,
  OAuthTokenRecord,
} from '../../../../packages/store/src/oauth.js';
import type { VerifiedRemoteIdentity } from './cloudflare.js';
import {
  SUPPORTED_SCOPES,
  base64urlSha256,
  normalizeScope,
  safeEqualText,
  validateRedirectUri,
} from './oauth-helpers.js';

export interface OAuthServiceOptions {
  issuer: string;
  resource: string;
  now?: () => Date;
  authorizationRequestTtlMs?: number;
  authorizationCodeTtlMs?: number;
  accessTokenTtlMs?: number;
  refreshTokenTtlMs?: number;
}

export interface DynamicClientRegistrationInput {
  client_name?: string;
  redirect_uris?: string[];
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
  application_type?: string;
}

export interface AuthorizationRequestInput {
  client_id: string;
  redirect_uri: string;
  response_type: string;
  scope?: string;
  resource?: string;
  code_challenge: string;
  code_challenge_method: string;
  state?: string;
}

export interface AuthorizationCodeExchangeInput {
  grant_type: 'authorization_code';
  client_id: string;
  code: string;
  redirect_uri: string;
  code_verifier: string;
  resource: string;
}

export interface RefreshTokenExchangeInput {
  grant_type: 'refresh_token';
  client_id: string;
  refresh_token: string;
  resource: string;
  scope?: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
  refresh_token?: string;
}

function publicClient(record: OAuthClientRecord, applicationType?: string) {
  return {
    client_id: record.clientId,
    client_name: record.clientName,
    redirect_uris: record.redirectUris,
    token_endpoint_auth_method: record.tokenEndpointAuthMethod,
    grant_types: record.grantTypes,
    response_types: record.responseTypes,
    ...(applicationType ? { application_type: applicationType } : {}),
    client_id_issued_at: Math.floor(Date.parse(record.createdAt) / 1000),
  };
}

export class AevraOAuthService {
  private _issuer: string;
  private _resource: string;
  get issuer() {
    return this._issuer;
  }
  get resource() {
    return this._resource;
  }
  private now: () => Date;
  private requestTtlMs: number;
  private codeTtlMs: number;
  private accessTtlMs: number;
  private refreshTtlMs: number;

  constructor(
    private repo: OAuthRepository,
    options: OAuthServiceOptions,
  ) {
    this._issuer = options.issuer.replace(/\/$/, '');
    this._resource = options.resource;
    this.now = options.now ?? (() => new Date());
    this.requestTtlMs = options.authorizationRequestTtlMs ?? 5 * 60_000;
    this.codeTtlMs = options.authorizationCodeTtlMs ?? 2 * 60_000;
    this.accessTtlMs = options.accessTokenTtlMs ?? 60 * 60_000;
    this.refreshTtlMs = options.refreshTokenTtlMs ?? 30 * 24 * 60 * 60_000;
  }

  setPublicBaseUrl(baseUrl: string) {
    const base = baseUrl.replace(/\/$/, '');
    const url = new URL(base);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash)
      throw new Error('OAuth public base URL must be an HTTPS origin');
    this._issuer = base;
    this._resource = `${base}/mcp`;
  }

  protectedResourceMetadata() {
    return {
      resource: this.resource,
      authorization_servers: [this.issuer],
      bearer_methods_supported: ['header'],
      scopes_supported: [...SUPPORTED_SCOPES],
    };
  }

  authorizationServerMetadata() {
    return {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/oauth/authorize`,
      token_endpoint: `${this.issuer}/oauth/token`,
      registration_endpoint: `${this.issuer}/oauth/register`,
      revocation_endpoint: `${this.issuer}/oauth/revoke`,
      scopes_supported: [...SUPPORTED_SCOPES],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      authorization_response_iss_parameter_supported: true,
    };
  }

  registerClient(input: DynamicClientRegistrationInput) {
    const redirectUris = Array.isArray(input.redirect_uris) ? input.redirect_uris.map(String) : [];
    if (!redirectUris.length) throw new Error('redirect_uris must contain at least one URI');
    const unique = [...new Set(redirectUris.map(validateRedirectUri))];
    const authMethod = input.token_endpoint_auth_method ?? 'none';
    if (authMethod !== 'none')
      throw new Error(
        'only public OAuth clients with token_endpoint_auth_method=none are supported',
      );
    const applicationType =
      input.application_type == null ? undefined : String(input.application_type);
    if (applicationType && !['native', 'web'].includes(applicationType))
      throw new Error('application_type must be native or web');
    if (
      input.grant_types &&
      input.grant_types.some(
        (value) => !['authorization_code', 'refresh_token'].includes(String(value)),
      )
    )
      throw new Error('unsupported OAuth grant type');
    if (input.response_types && input.response_types.some((value) => String(value) !== 'code'))
      throw new Error('unsupported OAuth response type');
    const record = this.repo.registerClient({
      clientName: String(input.client_name ?? 'MCP client').trim() || 'MCP client',
      redirectUris: unique,
    });
    return publicClient(record, applicationType);
  }

  listClients() {
    return this.repo.listClients().map((record) => ({
      clientId: record.clientId,
      clientName: record.clientName,
      actor: `oauth:${record.clientName}`,
      redirectUris: [...record.redirectUris],
      createdAt: record.createdAt,
    }));
  }

  beginAuthorization(
    input: AuthorizationRequestInput,
    remoteIp?: string,
  ): OAuthAuthorizationRequestRecord {
    const client = this.repo.getClient(String(input.client_id ?? ''));
    if (!client) throw new Error('unknown OAuth client_id');
    if (input.response_type !== 'code') throw new Error('response_type must be code');
    if (!client.redirectUris.includes(input.redirect_uri))
      throw new Error('redirect_uri does not exactly match the registered client');
    if (input.resource !== this.resource)
      throw new Error('resource does not match this MCP server');
    if (input.code_challenge_method !== 'S256')
      throw new Error('PKCE code_challenge_method must be S256');
    if (!input.code_challenge || input.code_challenge.length < 43)
      throw new Error('PKCE code_challenge is required');
    const scope = normalizeScope(input.scope);
    return this.repo.createAuthorizationRequest(
      {
        clientId: client.clientId,
        redirectUri: input.redirect_uri,
        scope,
        resource: this.resource,
        codeChallenge: input.code_challenge,
        codeChallengeMethod: 'S256',
        state: input.state,
        remoteIp,
      },
      this.requestTtlMs,
    );
  }

  authorizationStatus(id: string) {
    const request = this.repo.getAuthorizationRequest(id);
    return request ?? { id, status: 'EXPIRED' };
  }
  listPendingAuthorizations() {
    return this.repo.listPendingAuthorizationRequests().map((request) => ({
      ...request,
      clientName: this.repo.getClient(request.clientId)?.clientName ?? request.clientId,
      requestedScopes: request.scope.split(/\s+/).filter(Boolean),
    }));
  }
  approveAuthorization(id: string) {
    const request = this.repo.approveAuthorizationRequest(id);
    if (!request) throw new Error('OAuth authorization request not found');
    return request;
  }
  denyAuthorization(id: string) {
    const request = this.repo.denyAuthorizationRequest(id);
    if (!request) throw new Error('OAuth authorization request not found');
    return request;
  }

  continueAuthorization(id: string) {
    const request = this.repo.getAuthorizationRequest(id);
    if (!request || request.status !== 'APPROVED')
      throw new Error('OAuth authorization request is not approved');
    const { code } = this.repo.issueAuthorizationCode(id, this.codeTtlMs);
    const redirect = new URL(request.redirectUri);
    redirect.searchParams.set('code', code);
    redirect.searchParams.set('iss', this.issuer);
    if (request.state) redirect.searchParams.set('state', request.state);
    return { code, redirectUrl: redirect.toString() };
  }

  exchangeAuthorizationCode(input: AuthorizationCodeExchangeInput): OAuthTokenResponse {
    if (input.grant_type !== 'authorization_code') throw new Error('unsupported grant_type');
    if (input.resource !== this.resource)
      throw new Error('resource does not match this MCP server');
    const code = this.repo.consumeAuthorizationCode(input.code);
    if (!code) throw new Error('invalid authorization code');
    if (
      code.clientId !== input.client_id ||
      code.redirectUri !== input.redirect_uri ||
      code.resource !== input.resource
    )
      throw new Error('authorization code binding mismatch');
    if (!input.code_verifier || input.code_verifier.length < 43)
      throw new Error('PKCE code_verifier is invalid');
    if (!safeEqualText(base64urlSha256(input.code_verifier), code.codeChallenge))
      throw new Error('PKCE verification failed');
    return this.issueGrantTokens(code);
  }

  exchangeRefreshToken(input: RefreshTokenExchangeInput): OAuthTokenResponse {
    if (input.grant_type !== 'refresh_token') throw new Error('unsupported grant_type');
    if (input.resource !== this.resource)
      throw new Error('resource does not match this MCP server');
    const current = this.repo.findRefreshToken(input.refresh_token);
    if (!current || current.clientId !== input.client_id || current.resource !== this.resource)
      throw new Error('invalid refresh token');
    const requestedScope = input.scope ? normalizeScope(input.scope) : current.scope;
    const currentScopes = new Set(current.scope.split(/\s+/));
    if (requestedScope.split(/\s+/).some((scope) => !currentScopes.has(scope)))
      throw new Error('refresh scope exceeds original grant');
    const rotated = this.repo.rotateRefreshToken(input.refresh_token, this.refreshTtlMs);
    if (!rotated) throw new Error('invalid refresh token');
    const grant: OAuthTokenRecord = {
      clientId: current.clientId,
      actor: current.actor,
      subject: current.subject,
      scope: requestedScope,
      resource: current.resource,
      createdAt: this.now().toISOString(),
      expiresAt: new Date(this.now().getTime() + this.accessTtlMs).toISOString(),
    };
    const access = this.repo.issueAccessToken(grant, this.accessTtlMs);
    return {
      access_token: access.token,
      token_type: 'Bearer',
      expires_in: Math.floor(this.accessTtlMs / 1000),
      scope: requestedScope,
      refresh_token: rotated.token,
    };
  }

  verifyAccessToken(token: string): VerifiedRemoteIdentity {
    const record = this.repo.findAccessToken(token);
    if (!record || record.resource !== this.resource) throw new Error('invalid OAuth access token');
    return {
      actor: record.actor,
      subject: record.subject,
      issuer: this.issuer,
      audience: this.resource,
      expiresAt: record.expiresAt,
    };
  }

  revoke(token: string) {
    this.repo.revokeToken(token);
  }

  private issueGrantTokens(grant: {
    clientId: string;
    actor: string;
    subject: string;
    scope: string;
    resource: string;
  }): OAuthTokenResponse {
    const access = this.repo.issueAccessToken(grant, this.accessTtlMs);
    const response: OAuthTokenResponse = {
      access_token: access.token,
      token_type: 'Bearer',
      expires_in: Math.floor(this.accessTtlMs / 1000),
      scope: grant.scope,
    };
    if (grant.scope.split(/\s+/).includes('offline_access'))
      response.refresh_token = this.repo.issueRefreshToken(grant, this.refreshTtlMs).token;
    return response;
  }
}
