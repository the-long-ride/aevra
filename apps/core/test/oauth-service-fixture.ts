import { createHash } from 'node:crypto';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { OAuthRepository } from '../../../packages/store/src/oauth.js';
import { AevraOAuthService } from '../src/auth/oauth.js';
const b64url = (value: Buffer) => value.toString('base64url');
export const challenge = (verifier: string) =>
  b64url(createHash('sha256').update(verifier).digest());

export function fixture() {
  let now = Date.parse('2026-08-17T12:00:00.000Z');
  const db = AevraDatabase.open(':memory:');
  const repo = new OAuthRepository(db.raw(), () => new Date(now));
  const service = new AevraOAuthService(repo, {
    issuer: 'https://mcp.example.com',
    resource: 'https://mcp.example.com/mcp',
    now: () => new Date(now),
  });
  return {
    db,
    repo,
    service,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

export function issueGrant(service: AevraOAuthService, client: any, verifier: string) {
  const pending = service.beginAuthorization(
    {
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0]!,
      response_type: 'code',
      scope: 'mcp offline_access',
      resource: 'https://mcp.example.com/mcp',
      code_challenge: challenge(verifier),
      code_challenge_method: 'S256',
    },
    '203.0.113.4',
  );
  service.approveAuthorization(pending.id);
  const { code } = service.continueAuthorization(pending.id);
  return service.exchangeAuthorizationCode({
    grant_type: 'authorization_code',
    client_id: client.client_id,
    code,
    redirect_uri: client.redirect_uris[0]!,
    code_verifier: verifier,
    resource: 'https://mcp.example.com/mcp',
  });
}
