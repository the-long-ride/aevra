import { randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { eqHash, hash, secret } from './oauth-crypto.js';
import { OAuthConnectionStore } from './oauth-connection-store.js';
import {
  OAuthConnectionOriginsRepository,
  type ConnectionOriginRecord,
} from './oauth-connection-origins.js';
import { clientFromRow } from './oauth-records.js';
import { OAuthTokenStore, type RefreshRotationResult } from './oauth-token-store.js';
export type { ConnectionOriginRecord } from './oauth-connection-origins.js';
export type { RefreshRotationResult } from './oauth-token-store.js';
export type * from './oauth-records.js';
import type {
  OAuthAuthorizationCodeRecord,
  OAuthAuthorizationRequestRecord,
  OAuthClientRecord,
  OAuthGrantRecord,
  OAuthRefreshFamilyRecord,
} from './oauth-records.js';

export class OAuthRepository {
  private connections: OAuthConnectionStore;
  private tokens: OAuthTokenStore;
  private origins: OAuthConnectionOriginsRepository;

  constructor(
    private db: DatabaseSync,
    private now: () => Date = () => new Date(),
  ) {
    this.connections = new OAuthConnectionStore(db, now);
    this.tokens = new OAuthTokenStore(db, now);
    this.origins = new OAuthConnectionOriginsRepository(db);
  }

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
      renewable?: boolean;
    },
    ttlMs: number,
  ): OAuthAuthorizationRequestRecord {
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + ttlMs);
    const renewable = input.renewable ?? true;
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
      renewable,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    this.db
      .prepare(
        'INSERT INTO oauth_authorization_requests(id,client_id,redirect_uri,scope,resource,code_challenge,code_challenge_method,oauth_state,remote_ip,pairing_code,status,renewable,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
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
        record.renewable ? 1 : 0,
        record.createdAt,
        record.expiresAt,
      );
    return record;
  }

  getAuthorizationRequest(id: string): OAuthAuthorizationRequestRecord | null {
    const row = this.db
      .prepare(
        'SELECT id,client_id clientId,redirect_uri redirectUri,scope,resource,code_challenge codeChallenge,code_challenge_method codeChallengeMethod,oauth_state state,remote_ip remoteIp,pairing_code pairingCode,status,renewable,created_at createdAt,expires_at expiresAt,decided_at decidedAt FROM oauth_authorization_requests WHERE id=?',
      )
      .get(id) as any | undefined;
    if (!row) return null;
    if (Date.parse(row.expiresAt) <= this.now().getTime() && row.status === 'PENDING') {
      this.db.prepare('DELETE FROM oauth_authorization_requests WHERE id=?').run(id);
      return null;
    }
    return {
      ...row,
      codeChallengeMethod: 'S256',
      renewable: row.renewable !== undefined ? Boolean(row.renewable) : true,
    } as OAuthAuthorizationRequestRecord;
  }

  listPendingAuthorizationRequests(): OAuthAuthorizationRequestRecord[] {
    this.db
      .prepare("DELETE FROM oauth_authorization_requests WHERE status='PENDING' AND expires_at<=?")
      .run(this.now().toISOString());
    return (
      this.db
        .prepare(
          "SELECT id,client_id clientId,redirect_uri redirectUri,scope,resource,code_challenge codeChallenge,code_challenge_method codeChallengeMethod,oauth_state state,remote_ip remoteIp,pairing_code pairingCode,status,renewable,created_at createdAt,expires_at expiresAt,decided_at decidedAt FROM oauth_authorization_requests WHERE status='PENDING' ORDER BY created_at",
        )
        .all() as any[]
    ).map((row) => ({
      ...row,
      codeChallengeMethod: 'S256',
      renewable: row.renewable !== undefined ? Boolean(row.renewable) : true,
    }));
  }

  approveAuthorizationRequest(id: string, options?: { renewable?: boolean }) {
    return this.decideAuthorizationRequest(id, 'APPROVED', options);
  }

  denyAuthorizationRequest(id: string) {
    return this.decideAuthorizationRequest(id, 'DENIED');
  }

  issueAuthorizationCode(requestId: string, ttlMs: number) {
    const request = this.getAuthorizationRequest(requestId);
    if (
      !request ||
      request.status !== 'APPROVED' ||
      Date.parse(request.expiresAt) <= this.now().getTime()
    ) {
      throw new Error('OAuth authorization request is not approved');
    }
    const client = this.getClient(request.clientId);
    if (!client) throw new Error('OAuth client no longer exists');
    const code = secret(32);
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + ttlMs);
    const actor = `oauth:${client.clientName}`;
    const subject = `oauth_grant_${randomUUID()}`;
    const renewable = request.renewable !== false;
    this.db
      .prepare(
        'INSERT INTO oauth_authorization_codes(code_hash,client_id,redirect_uri,scope,resource,code_challenge,actor,subject,renewable,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
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
        renewable ? 1 : 0,
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
        'SELECT code_hash codeHash,client_id clientId,redirect_uri redirectUri,scope,resource,code_challenge codeChallenge,actor,subject,renewable,created_at createdAt,expires_at expiresAt FROM oauth_authorization_codes WHERE code_hash=?',
      )
      .get(codeHash) as any | undefined;
    if (!row || !eqHash(codeHash, String(row.codeHash))) return null;
    this.db.prepare('DELETE FROM oauth_authorization_codes WHERE code_hash=?').run(codeHash);
    if (Date.parse(row.expiresAt) <= this.now().getTime()) return null;
    delete row.codeHash;
    return {
      ...row,
      renewable: row.renewable !== undefined ? Boolean(row.renewable) : true,
    } as OAuthAuthorizationCodeRecord;
  }

  issueAccessToken(grant: OAuthGrantRecord, ttlMs: number) {
    const connection = this.ensureConnection(grant);
    if (connection.status !== 'ACTIVE') throw new Error('OAuth connection is revoked');
    return this.tokens.issueAccessToken(grant, ttlMs);
  }

  issueRefreshToken(grant: OAuthGrantRecord, ttlMs: number, familyId?: string) {
    const connection = this.ensureConnection(grant);
    if (connection.status !== 'ACTIVE') throw new Error('OAuth connection is revoked');
    return this.tokens.issueRefreshToken(grant, ttlMs, familyId);
  }

  findAccessToken(token: string) {
    return this.tokens.findAccessToken(token);
  }

  findRefreshToken(token: string) {
    return this.tokens.findRefreshToken(token);
  }

  rotateRefreshTokenSecurely(token: string, ttlMs: number): RefreshRotationResult {
    return this.tokens.rotateRefreshTokenSecurely(token, ttlMs);
  }

  revokeToken(token: string) {
    this.tokens.revokeToken(token);
  }

  ensureConnection(grant: OAuthGrantRecord) {
    return this.connections.ensure(grant);
  }

  getConnection(subject: string) {
    return this.connections.get(subject);
  }

  listConnections() {
    return this.connections.list();
  }

  touchConnection(subject: string) {
    this.connections.touch(subject);
  }

  setConnectionYolo(subject: string, enabled: boolean) {
    return this.connections.setYolo(subject, enabled);
  }

  markConnectionConnected(subject: string) {
    this.connections.markConnected(subject);
  }

  markConnectionGrace(subject: string, disconnectedAt: string, graceExpiresAt: string) {
    this.connections.markGrace(subject, disconnectedAt, graceExpiresAt);
  }

  clearConnectionGrace(subject: string) {
    this.connections.clearGrace(subject);
  }

  revokeConnection(subject: string, reason: string) {
    this.tokens.revokeConnectionCredentials(subject, reason);
  }

  revokeRefreshFamily(familyId: string, reason: string) {
    this.tokens.revokeRefreshFamily(familyId, reason);
  }

  getLatestRefreshFamily(subject: string): OAuthRefreshFamilyRecord | null {
    return this.tokens.getLatestFamilyForSubject(subject);
  }

  clearRememberedWorkspaceGrants(subject: string) {
    this.db.prepare('DELETE FROM oauth_workspace_grants WHERE subject=?').run(subject);
  }

  recordConnectionOrigin(subject: string, remoteIp: string, at?: string): void {
    this.origins.record(subject, remoteIp, at ?? this.now().toISOString());
  }

  listConnectionOrigins(subject: string, now?: string): ConnectionOriginRecord[] {
    return this.origins.list(subject, now ?? this.now().toISOString());
  }

  invalidateEphemeralForRestart() {
    this.db.exec(
      'DELETE FROM oauth_authorization_requests; DELETE FROM oauth_authorization_codes;',
    );
  }

  private decideAuthorizationRequest(
    id: string,
    status: 'APPROVED' | 'DENIED',
    options?: { renewable?: boolean },
  ) {
    const current = this.getAuthorizationRequest(id);
    if (!current) return null;
    const decidedAt = this.now().toISOString();
    const renewable = options?.renewable !== undefined ? options.renewable : current.renewable;
    this.db
      .prepare(
        "UPDATE oauth_authorization_requests SET status=?,renewable=?,decided_at=? WHERE id=? AND status='PENDING'",
      )
      .run(status, renewable ? 1 : 0, decidedAt, id);
    return this.getAuthorizationRequest(id);
  }
}
