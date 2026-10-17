import type { OAuthRepository } from '../../../../packages/store/src/oauth.js';
import type { OAuthTokenResponse } from './oauth-types.js';
export function issueGrantTokens(
  repo: OAuthRepository,
  accessTtlMs: number,
  refreshTtlMs: number,
  grant: {
    clientId: string;
    actor: string;
    subject: string;
    scope: string;
    resource: string;
    renewable?: boolean;
  },
): OAuthTokenResponse {
  repo.ensureConnection(grant);
  const access = repo.issueAccessToken(grant, accessTtlMs);
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
    expires_in: Math.floor(accessTtlMs / 1000),
    scope: grantedScope,
  };
  const shouldIssueRefresh =
    grant.renewable !== undefined
      ? grant.renewable
      : grant.scope.split(/\s+/).includes('offline_access');
  if (shouldIssueRefresh) {
    response.refresh_token = repo.issueRefreshToken(grant, refreshTtlMs).token;
  }
  return response;
}
