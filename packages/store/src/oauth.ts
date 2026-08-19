import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

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
    const v = JSON.parse(String(value ?? '[]'));
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
function secret(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}
function eqHash(left: string, right: string) {
  return (
    left.length === right.length &&
    timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
  );
}
function clientFromRow(row: any): OAuthClientRecord {
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

export class OAuthRepository {
  constructor(
    private db: DatabaseSync,
    private now: () => Date = () => new Date(),
  ) {}

  registerClient(input: { clientName: string; redirectUris: string[] }): OAuthClientRecord {
    const createdAt = this.now().toISOString();
    const record: OAuthClientRecord = {
      clientId: `oauth_client_${randomUUID()}`,
      clientName: input.clientName,
      redirectUris: [...input.redirectUris],
      tokenEndpointAuthMethod: 'none',
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      createdAt,
    };
    this.db
      .prepare(
        'INSERT INTO oauth_clients(client_id,client_name,redirect_uris_json,token_endpoint_auth_method,grant_types_json,response_types_json,created_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        record.clientId,
        record.clientName,
        JSON.stringify(record.redirectUris),
        record.tokenEndpointAuthMethod,
        JSON.stringify(record.grantTypes),
        JSON.stringify(record.responseTypes),
        record.createdAt,
      );
    return record;
  }

  getClient(clientId: string): OAuthClientRecord | null {
    const row = this.db
      .prepare(
        'SELECT client_id clientId,client_name clientName,redirect_uris_json redirectUrisJson,token_endpoint_auth_method tokenEndpointAuthMethod,grant_types_json grantTypesJson,response_types_json responseTypesJson,created_at createdAt FROM oauth_clients WHERE client_id=?',
      )
      .get(clientId) as any | undefined;
    return row ? clientFromRow(row) : null;
  }

  listClients(): OAuthClientRecord[] {
    return (
      this.db
        .prepare(
          'SELECT client_id clientId,client_name clientName,redirect_uris_json redirectUrisJson,token_endpoint_auth_method tokenEndpointAuthMethod,grant_types_json grantTypesJson,response_types_json responseTypesJson,created_at createdAt FROM oauth_clients ORDER BY created_at,client_name',
        )
        .all() as any[]
    ).map(clientFromRow);
  }

  createAuthorizationRequest(
    input: {
      clientId: string;
      redirectUri: string;
      scope: string;
      resource: string;
      codeChallenge: string;
      codeChallengeMethod: 'S256';
      state?: string;
      remoteIp?: string;
    },
    ttlMs: number,
  ): OAuthAuthorizationRequestRecord {
    const createdAt = this.now(),
      expiresAt = new Date(createdAt.getTime() + ttlMs);
    const record: OAuthAuthorizationRequestRecord = {
      id: `oauth_req_${randomUUID()}`,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      scope: input.scope,
      resource: input.resource,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: 'S256',
      state: input.state,
      remoteIp: input.remoteIp,
      pairingCode: randomBytes(4).toString('hex').toUpperCase(),
      status: 'PENDING',
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    this.db
      .prepare(
        'INSERT INTO oauth_authorization_requests(id,client_id,redirect_uri,scope,resource,code_challenge,code_challenge_method,oauth_state,remote_ip,pairing_code,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        record.id,
        record.clientId,
        record.redirectUri,
        record.scope,
        record.resource,
        record.codeChallenge,
        record.codeChallengeMethod,
        record.state ?? null,
        record.remoteIp ?? null,
        record.pairingCode,
        record.status,
        record.createdAt,
        record.expiresAt,
      );
    return record;
  }

  getAuthorizationRequest(id: string): OAuthAuthorizationRequestRecord | null {
    const row = this.db
      .prepare(
        'SELECT id,client_id clientId,redirect_uri redirectUri,scope,resource,code_challenge codeChallenge,code_challenge_method codeChallengeMethod,oauth_state state,remote_ip remoteIp,pairing_code pairingCode,status,created_at createdAt,expires_at expiresAt,decided_at decidedAt FROM oauth_authorization_requests WHERE id=?',
      )
      .get(id) as any | undefined;
    if (!row) return null;
    if (Date.parse(row.expiresAt) <= this.now().getTime() && row.status === 'PENDING') {
      this.db.prepare('DELETE FROM oauth_authorization_requests WHERE id=?').run(id);
      return null;
    }
    return { ...row, codeChallengeMethod: 'S256' } as OAuthAuthorizationRequestRecord;
  }

  listPendingAuthorizationRequests(): OAuthAuthorizationRequestRecord[] {
    this.db
      .prepare("DELETE FROM oauth_authorization_requests WHERE status='PENDING' AND expires_at<=?")
      .run(this.now().toISOString());
    return (
      this.db
        .prepare(
          "SELECT id,client_id clientId,redirect_uri redirectUri,scope,resource,code_challenge codeChallenge,code_challenge_method codeChallengeMethod,oauth_state state,remote_ip remoteIp,pairing_code pairingCode,status,created_at createdAt,expires_at expiresAt,decided_at decidedAt FROM oauth_authorization_requests WHERE status='PENDING' ORDER BY created_at",
        )
        .all() as any[]
    ).map((row) => ({ ...row, codeChallengeMethod: 'S256' }));
  }

  approveAuthorizationRequest(id: string) {
    return this.decideAuthorizationRequest(id, 'APPROVED');
  }
  denyAuthorizationRequest(id: string) {
    return this.decideAuthorizationRequest(id, 'DENIED');
  }
  private decideAuthorizationRequest(id: string, status: 'APPROVED' | 'DENIED') {
    const current = this.getAuthorizationRequest(id);
    if (!current) return null;
    const decidedAt = this.now().toISOString();
    this.db
      .prepare(
        "UPDATE oauth_authorization_requests SET status=?,decided_at=? WHERE id=? AND status='PENDING'",
      )
      .run(status, decidedAt, id);
    return this.getAuthorizationRequest(id);
  }

  issueAuthorizationCode(
    requestId: string,
    ttlMs: number,
  ): { code: string; request: OAuthAuthorizationRequestRecord } {
    const request = this.getAuthorizationRequest(requestId);
    if (
      !request ||
      request.status !== 'APPROVED' ||
      Date.parse(request.expiresAt) <= this.now().getTime()
    )
      throw new Error('OAuth authorization request is not approved');
    const client = this.getClient(request.clientId);
    if (!client) throw new Error('OAuth client no longer exists');
    const code = secret(32),
      createdAt = this.now(),
      expiresAt = new Date(createdAt.getTime() + ttlMs);
    const actor = `oauth:${client.clientName}`,
      subject = `oauth_grant_${randomUUID()}`;
    this.db
      .prepare(
        'INSERT INTO oauth_authorization_codes(code_hash,client_id,redirect_uri,scope,resource,code_challenge,actor,subject,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        hash(code),
        request.clientId,
        request.redirectUri,
        request.scope,
        request.resource,
        request.codeChallenge,
        actor,
        subject,
        createdAt.toISOString(),
        expiresAt.toISOString(),
      );
    this.db.prepare('DELETE FROM oauth_authorization_requests WHERE id=?').run(requestId);
    return { code, request };
  }

  consumeAuthorizationCode(code: string): OAuthAuthorizationCodeRecord | null {
    const codeHash = hash(code);
    const row = this.db
      .prepare(
        'SELECT code_hash codeHash,client_id clientId,redirect_uri redirectUri,scope,resource,code_challenge codeChallenge,actor,subject,created_at createdAt,expires_at expiresAt FROM oauth_authorization_codes WHERE code_hash=?',
      )
      .get(codeHash) as any | undefined;
    if (!row) return null;
    if (!eqHash(codeHash, String(row.codeHash))) {
      return null;
    }
    this.db.prepare('DELETE FROM oauth_authorization_codes WHERE code_hash=?').run(codeHash);
    if (Date.parse(row.expiresAt) <= this.now().getTime()) return null;
    delete row.codeHash;
    return row as OAuthAuthorizationCodeRecord;
  }

  issueAccessToken(
    grant: OAuthGrantRecord,
    ttlMs: number,
  ): { token: string; record: OAuthTokenRecord } {
    return this.issueToken('access', grant, ttlMs);
  }
  issueRefreshToken(
    grant: OAuthGrantRecord,
    ttlMs: number,
    familyId = `oauth_family_${randomUUID()}`,
  ): { token: string; record: OAuthTokenRecord & { familyId: string } } {
    const token = secret(32),
      createdAt = this.now(),
      expiresAt = new Date(createdAt.getTime() + ttlMs),
      record = {
        ...grant,
        familyId,
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      };
    this.db
      .prepare(
        'INSERT INTO oauth_refresh_tokens(token_hash,family_id,client_id,actor,subject,scope,resource,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .run(
        hash(token),
        familyId,
        grant.clientId,
        grant.actor,
        grant.subject,
        grant.scope,
        grant.resource,
        record.createdAt,
        record.expiresAt,
      );
    return { token, record };
  }
  private issueToken(
    kind: 'access',
    grant: OAuthGrantRecord,
    ttlMs: number,
  ): { token: string; record: OAuthTokenRecord } {
    const token = secret(32),
      createdAt = this.now(),
      expiresAt = new Date(createdAt.getTime() + ttlMs),
      record = {
        ...grant,
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + ttlMs).toISOString(),
      };
    this.db
      .prepare(
        'INSERT INTO oauth_access_tokens(token_hash,client_id,actor,subject,scope,resource,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(
        hash(token),
        grant.clientId,
        grant.actor,
        grant.subject,
        grant.scope,
        grant.resource,
        record.createdAt,
        record.expiresAt,
      );
    return { token, record };
  }

  findAccessToken(token: string): OAuthTokenRecord | null {
    return this.findToken('oauth_access_tokens', token) as OAuthTokenRecord | null;
  }
  findRefreshToken(token: string): (OAuthTokenRecord & { familyId: string }) | null {
    return this.findToken('oauth_refresh_tokens', token, true) as
      (OAuthTokenRecord & { familyId: string }) | null;
  }
  private findToken(
    table: 'oauth_access_tokens' | 'oauth_refresh_tokens',
    token: string,
    refresh = false,
  ): OAuthTokenRecord | (OAuthTokenRecord & { familyId: string }) | null {
    const tokenHash = hash(token);
    const columns = refresh
      ? 'token_hash tokenHash,family_id familyId,client_id clientId,actor,subject,scope,resource,created_at createdAt,expires_at expiresAt'
      : 'token_hash tokenHash,client_id clientId,actor,subject,scope,resource,created_at createdAt,expires_at expiresAt';
    const row = this.db
      .prepare(`SELECT ${columns} FROM ${table} WHERE token_hash=?`)
      .get(tokenHash) as any | undefined;
    if (!row || !eqHash(tokenHash, String(row.tokenHash))) return null;
    if (Date.parse(row.expiresAt) <= this.now().getTime()) {
      this.db.prepare(`DELETE FROM ${table} WHERE token_hash=?`).run(tokenHash);
      return null;
    }
    delete row.tokenHash;
    return row;
  }

  rotateRefreshToken(
    token: string,
    ttlMs: number,
  ): { token: string; record: OAuthTokenRecord & { familyId: string } } | null {
    const current = this.findRefreshToken(token);
    if (!current) return null;
    this.db.prepare('DELETE FROM oauth_refresh_tokens WHERE token_hash=?').run(hash(token));
    return this.issueRefreshToken(current, ttlMs, current.familyId);
  }

  revokeToken(token: string) {
    const tokenHash = hash(token);
    this.db.prepare('DELETE FROM oauth_access_tokens WHERE token_hash=?').run(tokenHash);
    this.db.prepare('DELETE FROM oauth_refresh_tokens WHERE token_hash=?').run(tokenHash);
  }
  invalidateEphemeralForRestart() {
    this.db.exec(
      'DELETE FROM oauth_authorization_requests; DELETE FROM oauth_authorization_codes;',
    );
  }
}
