import { randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { OAuthAuthorizationRequestRecord } from './oauth-records.js';

export class OAuthAuthorizationStore {
  constructor(
    private db: DatabaseSync,
    private now: () => Date,
  ) {}
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
