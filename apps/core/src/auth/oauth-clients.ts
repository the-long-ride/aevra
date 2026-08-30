import type { OAuthClientRecord, OAuthRepository } from '../../../../packages/store/src/oauth.js';
import { stripControlCharacters } from '../../../../packages/security/src/untrusted.js';
import { validateRedirectUri } from './oauth-helpers.js';

const MAX_CLIENT_NAME = 80;
const MAX_CLIENTS = 50;

export interface DynamicClientRegistrationInput {
  client_name?: string;
  redirect_uris?: string[];
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
  application_type?: string;
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

export function registerOAuthClient(repo: OAuthRepository, input: DynamicClientRegistrationInput) {
  const redirectUris = Array.isArray(input.redirect_uris) ? input.redirect_uris.map(String) : [];
  if (!redirectUris.length) throw new Error('redirect_uris must contain at least one URI');
  const unique = [...new Set(redirectUris.map(validateRedirectUri))];
  if ((input.token_endpoint_auth_method ?? 'none') !== 'none') {
    throw new Error('only public OAuth clients with token_endpoint_auth_method=none are supported');
  }
  const applicationType =
    input.application_type == null ? undefined : String(input.application_type);
  if (applicationType && !['native', 'web'].includes(applicationType)) {
    throw new Error('application_type must be native or web');
  }
  if (
    input.grant_types?.some(
      (value) => !['authorization_code', 'refresh_token'].includes(String(value)),
    )
  ) {
    throw new Error('unsupported OAuth grant type');
  }
  if (input.response_types?.some((value) => String(value) !== 'code')) {
    throw new Error('unsupported OAuth response type');
  }
  if (repo.listClients().length >= MAX_CLIENTS) throw new Error('too_many_clients');
  const clientName =
    stripControlCharacters(String(input.client_name ?? 'MCP client'))
      .trim()
      .slice(0, MAX_CLIENT_NAME) || 'MCP client';
  return publicClient(repo.registerClient({ clientName, redirectUris: unique }), applicationType);
}

export function listOAuthClients(repo: OAuthRepository) {
  return repo.listClients().map((record) => ({
    clientId: record.clientId,
    clientName: record.clientName,
    actor: `oauth:${record.clientName}`,
    redirectUris: [...record.redirectUris],
    createdAt: record.createdAt,
  }));
}
