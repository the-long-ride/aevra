export type { DynamicClientRegistrationInput } from './oauth-clients.js';

export interface OAuthAuditLogger {
  append(event: {
    actor?: string;
    operation: string;
    target?: string;
    result: string;
    redactionCount: number;
    class?: 'normal' | 'security';
    metadata?: Record<string, unknown>;
  }): void;
}

export interface OAuthServiceOptions {
  issuer: string;
  resource: string;
  now?: () => Date;
  authorizationRequestTtlMs?: number;
  authorizationCodeTtlMs?: number;
  accessTokenTtlMs?: number;
  refreshTokenTtlMs?: number;
  audit?: OAuthAuditLogger;
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
  renewable?: boolean;
}

export interface AuthorizationCodeExchangeInput {
  grant_type: 'authorization_code';
  client_id: string;
  code: string;
  redirect_uri: string;
  code_verifier: string;
  resource?: string;
}

export interface RefreshTokenExchangeInput {
  grant_type: 'refresh_token';
  client_id: string;
  refresh_token: string;
  resource?: string;
  scope?: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
  refresh_token?: string;
}
