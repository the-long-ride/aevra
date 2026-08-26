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

export interface OAuthConnectionRecord extends OAuthGrantRecord {
  status: 'ACTIVE' | 'REVOKED';
  yoloEnabled: boolean;
  createdAt: string;
  lastUsedAt: string;
  revokedAt?: string;
  revokeReason?: string;
  disconnectedAt?: string;
  graceExpiresAt?: string;
}

export interface OAuthRefreshTokenRecord extends OAuthTokenRecord {
  familyId: string;
  status: 'ACTIVE' | 'SPENT' | 'REVOKED';
  rotatedAt?: string;
  revokedAt?: string;
}

export interface OAuthRefreshFamilyRecord {
  familyId: string;
  subject: string;
  clientId: string;
  status: 'ACTIVE' | 'REVOKED';
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  revokeReason?: string;
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

export function connectionFromRow(row: any): OAuthConnectionRecord {
  return {
    clientId: String(row.clientId),
    actor: String(row.actor),
    subject: String(row.subject),
    scope: String(row.scope),
    resource: String(row.resource),
    status: String(row.status) as OAuthConnectionRecord['status'],
    yoloEnabled: Boolean(row.yoloEnabled),
    createdAt: String(row.createdAt),
    lastUsedAt: String(row.lastUsedAt),
    ...(row.revokedAt ? { revokedAt: String(row.revokedAt) } : {}),
    ...(row.revokeReason ? { revokeReason: String(row.revokeReason) } : {}),
    ...(row.disconnectedAt ? { disconnectedAt: String(row.disconnectedAt) } : {}),
    ...(row.graceExpiresAt ? { graceExpiresAt: String(row.graceExpiresAt) } : {}),
  };
}
