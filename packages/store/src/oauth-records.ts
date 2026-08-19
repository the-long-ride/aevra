export interface OAuthClientRecord {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: 'none';
  grantTypes: string[];
  responseTypes: string[];
  createdAt: string;
}

export interface OAuthAuthorizationRequestRecord {
  id: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  resource: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  state?: string;
  remoteIp?: string;
  pairingCode: string;
  status: 'PENDING' | 'APPROVED' | 'DENIED';
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
}

export interface OAuthGrantRecord {
  clientId: string;
  actor: string;
  subject: string;
  scope: string;
  resource: string;
}

export interface OAuthTokenRecord extends OAuthGrantRecord {
  createdAt: string;
  expiresAt: string;
}

export interface OAuthAuthorizationCodeRecord extends OAuthTokenRecord {
  redirectUri: string;
  codeChallenge: string;
}

function parseJsonArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? '[]'));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function clientFromRow(row: any): OAuthClientRecord {
  return {
    clientId: String(row.clientId),
    clientName: String(row.clientName),
    redirectUris: parseJsonArray(row.redirectUrisJson),
    tokenEndpointAuthMethod: 'none',
    grantTypes: parseJsonArray(row.grantTypesJson),
    responseTypes: parseJsonArray(row.responseTypesJson),
    createdAt: String(row.createdAt),
  };
}
