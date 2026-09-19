import type {
  OAuthAuthorizationRequestRecord,
  OAuthRepository,
} from '../../../../packages/store/src/oauth.js';
import type { VerifiedRemoteIdentity } from './cloudflare.js';
import {
  listOAuthClients,
  registerOAuthClient,
  type DynamicClientRegistrationInput,
} from './oauth-clients.js';
import {
  base64urlSha256,
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  normalizeScope,
  resolvedResource,
  safeEqualText,
} from './oauth-helpers.js';

export * from './oauth-types.js';
import type {
  AuthorizationCodeExchangeInput,
  AuthorizationRequestInput,
  OAuthAuditLogger,
  OAuthServiceOptions,
  OAuthTokenResponse,
  RefreshTokenExchangeInput,
} from './oauth-types.js';

export class AevraOAuthService {
  private _issuer: string;
  private _resource: string;
  private requestTtlMs: number;
  private codeTtlMs: number;
  private accessTtlMs: number;
  private refreshTtlMs: number;
  private audit?: OAuthAuditLogger;

  constructor(
    private repo: OAuthRepository,
    options: OAuthServiceOptions,
  ) {
    this._issuer = options.issuer.replace(/\/$/, '');
    this._resource = options.resource;
    this.requestTtlMs = options.authorizationRequestTtlMs ?? 5 * 60_000;
    this.codeTtlMs = options.authorizationCodeTtlMs ?? 2 * 60_000;
    this.accessTtlMs = options.accessTokenTtlMs ?? 60 * 60_000;
    this.refreshTtlMs = options.refreshTokenTtlMs ?? 30 * 24 * 60 * 60_000;
    this.audit = options.audit;
  }

  get issuer() {
    return this._issuer;
  }

  get resource() {
    return this._resource;
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
    return buildProtectedResourceMetadata(this.resource, this.issuer);
  }

  authorizationServerMetadata() {
    return buildAuthorizationServerMetadata(this.issuer);
  }

  registerClient(input: DynamicClientRegistrationInput) {
    return registerOAuthClient(this.repo, input);
  }

  listClients() {
    return listOAuthClients(this.repo);
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
    const resource = resolvedResource(input.resource, this.resource);
    if (input.code_challenge_method !== 'S256')
      throw new Error('PKCE code_challenge_method must be S256');
    if (!input.code_challenge || input.code_challenge.length < 43)
      throw new Error('PKCE code_challenge is required');
    const scope = normalizeScope(input.scope);
    const pending = this.repo.createAuthorizationRequest(
      {
        clientId: client.clientId,
        redirectUri: input.redirect_uri,
        scope,
        resource,
        codeChallenge: input.code_challenge,
        codeChallengeMethod: 'S256',
        state: input.state,
        remoteIp,
        renewable: input.renewable,
      },
      this.requestTtlMs,
    );
    this.audit?.append({
      actor: `client:${client.clientId}`,
      operation: 'oauth.authorize.request',
      target: pending.id,
      result: 'ok',
      redactionCount: 0,
      class: 'security',
      metadata: {
        clientId: client.clientId,
        requestedScope: pending.scope,
        remoteIp,
      },
    });
    return pending;
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

  approveAuthorization(id: string, options?: { renewable?: boolean }) {
    const request = this.repo.approveAuthorizationRequest(id, options);
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
    const resource = resolvedResource(input.resource, this.resource);
    const code = this.repo.consumeAuthorizationCode(input.code);
    if (!code) throw new Error('invalid authorization code');
    if (
      code.clientId !== input.client_id ||
      code.redirectUri !== input.redirect_uri ||
      code.resource !== resource
    )
      throw new Error('authorization code binding mismatch');
    if (!input.code_verifier || input.code_verifier.length < 43)
      throw new Error('PKCE code_verifier is invalid');
    if (!safeEqualText(base64urlSha256(input.code_verifier), code.codeChallenge))
      throw new Error('PKCE verification failed');
    const tokens = this.issueGrantTokens(code);
    this.audit?.append({
      actor: code.actor,
      operation: 'oauth.token.code_exchange',
      target: code.subject,
      result: 'ok',
      redactionCount: 0,
      class: 'security',
      metadata: {
        clientId: code.clientId,
        grantedScope: tokens.scope,
        refreshIssued: Boolean(tokens.refresh_token),
        expiresIn: tokens.expires_in,
      },
    });
    return tokens;
  }

  exchangeRefreshToken(input: RefreshTokenExchangeInput): OAuthTokenResponse {
    if (input.grant_type !== 'refresh_token') throw new Error('unsupported grant_type');
    const resource = resolvedResource(input.resource, this.resource);
    const current = this.repo.findRefreshToken(input.refresh_token);
    if (!current || current.clientId !== input.client_id || current.resource !== resource) {
      this.audit?.append({
        actor: input.client_id ? `client:${input.client_id}` : 'unknown',
        operation: 'oauth.token.refresh_failed',
        target: input.client_id,
        result: 'rejected',
        redactionCount: 0,
        class: 'security',
        metadata: { reason: 'invalid_refresh_token_binding' },
      });
      throw new Error('invalid refresh token');
    }
    if (current.status !== 'ACTIVE') {
      this.audit?.append({
        actor: current.actor,
        operation: 'oauth.token.refresh_failed',
        target: current.subject,
        result: 'rejected',
        redactionCount: 0,
        class: 'security',
        metadata: { reason: 'refresh_token_spent_or_inactive' },
      });
      this.repo.rotateRefreshTokenSecurely(input.refresh_token, this.refreshTtlMs);
      throw new Error('invalid refresh token');
    }
    const requestedScope = input.scope ? normalizeScope(input.scope) : current.scope;
    const currentScopes = new Set(current.scope.split(/\s+/));
    if (requestedScope.split(/\s+/).some((scope) => !currentScopes.has(scope))) {
      this.audit?.append({
        actor: current.actor,
        operation: 'oauth.token.refresh_failed',
        target: current.subject,
        result: 'rejected',
        redactionCount: 0,
        class: 'security',
        metadata: { reason: 'scope_exceeds_grant' },
      });
      throw new Error('refresh scope exceeds original grant');
    }
    const rotated = this.repo.rotateRefreshTokenSecurely(input.refresh_token, this.refreshTtlMs);
    if (rotated.status !== 'ROTATED') throw new Error('invalid refresh token');
    const access = this.repo.issueAccessToken(
      {
        clientId: current.clientId,
        actor: current.actor,
        subject: current.subject,
        scope: requestedScope,
        resource: current.resource,
      },
      this.accessTtlMs,
    );
    this.audit?.append({
      actor: current.actor,
      operation: 'oauth.token.refresh',
      target: current.subject,
      result: 'ok',
      redactionCount: 0,
      class: 'security',
      metadata: {
        clientId: current.clientId,
        grantedScope: requestedScope,
        expiresIn: Math.floor(this.accessTtlMs / 1000),
      },
    });
    return {
      access_token: access.token,
      token_type: 'Bearer',
      expires_in: Math.floor(this.accessTtlMs / 1000),
      scope: requestedScope,
      refresh_token: rotated.nextToken,
    };
  }

  verifyAccessToken(token: string, remoteIp?: string): VerifiedRemoteIdentity {
    const record = this.repo.findAccessToken(token);
    if (!record || record.resource !== this.resource) throw new Error('invalid OAuth access token');
    const connection = this.repo.getConnection(record.subject);
    if (!connection || connection.status !== 'ACTIVE')
      throw new Error('invalid OAuth access token');
    this.repo.touchConnection(record.subject);
    if (remoteIp) this.repo.recordConnectionOrigin(record.subject, remoteIp);
    return {
      actor: record.actor,
      subject: record.subject,
      connectionId: record.subject,
      issuer: this.issuer,
      audience: this.resource,
      expiresAt: record.expiresAt,
    };
  }

  recordConnectionOrigin(subject: string, remoteIp: string) {
    this.repo.recordConnectionOrigin(subject, remoteIp);
  }

  listConnectionOrigins(subject: string) {
    return this.repo.listConnectionOrigins(subject);
  }

  revoke(token: string) {
    this.repo.revokeToken(token);
  }

  revokeConnection(subject: string, reason = 'ADMIN_REVOKE') {
    this.repo.revokeConnection(subject, reason);
  }

  getLatestRefreshFamily(subject: string) {
    return this.repo.getLatestRefreshFamily(subject);
  }

  private issueGrantTokens(grant: {
    clientId: string;
    actor: string;
    subject: string;
    scope: string;
    resource: string;
    renewable?: boolean;
  }): OAuthTokenResponse {
    this.repo.ensureConnection(grant);
    const access = this.repo.issueAccessToken(grant, this.accessTtlMs);
    const grantedScope =
      grant.renewable === false
        ? grant.scope
            .split(/\s+/)
            .filter((s) => s !== 'offline_access')
            .join(' ')
        : grant.scope;
    const response: OAuthTokenResponse = {
      access_token: access.token,
      token_type: 'Bearer',
      expires_in: Math.floor(this.accessTtlMs / 1000),
      scope: grantedScope,
    };
    const shouldIssueRefresh =
      grant.renewable !== undefined
        ? grant.renewable
        : grant.scope.split(/\s+/).includes('offline_access');
    if (shouldIssueRefresh) {
      response.refresh_token = this.repo.issueRefreshToken(grant, this.refreshTtlMs).token;
    }
    return response;
  }
}
