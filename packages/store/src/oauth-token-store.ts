import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { eqHash, hash, secret } from './oauth-crypto.js';
import type {
  OAuthGrantRecord,
  OAuthRefreshFamilyRecord,
  OAuthRefreshTokenRecord,
  OAuthTokenRecord,
} from './oauth-records.js';

import type { RefreshRotationResult } from './oauth-token-types.js';
export type { RefreshRotationResult } from './oauth-token-types.js';

const ACCESS_COLUMNS =
  'token_hash tokenHash,client_id clientId,actor,subject,scope,resource,created_at createdAt,expires_at expiresAt';
const REFRESH_COLUMNS = `${ACCESS_COLUMNS},family_id familyId,status,rotated_at rotatedAt,revoked_at revokedAt`;

function refreshFromRow(row: any): OAuthRefreshTokenRecord {
  return {
    clientId: String(row.clientId),
    actor: String(row.actor),
    subject: String(row.subject),
    scope: String(row.scope),
    resource: String(row.resource),
    familyId: String(row.familyId),
    status: String(row.status) as OAuthRefreshTokenRecord['status'],
    createdAt: String(row.createdAt),
    expiresAt: String(row.expiresAt),
    ...(row.rotatedAt ? { rotatedAt: String(row.rotatedAt) } : {}),
    ...(row.revokedAt ? { revokedAt: String(row.revokedAt) } : {}),
  };
}

export class OAuthTokenStore {
  constructor(
    private db: DatabaseSync,
    private now: () => Date,
  ) {}

  issueAccessToken(grant: OAuthGrantRecord, ttlMs: number) {
    const token = secret(32);
    const createdAt = this.now();
    const record: OAuthTokenRecord = {
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

  issueRefreshToken(grant: OAuthGrantRecord, ttlMs: number, familyId?: string) {
    const createdAt = this.now();
    const id = familyId ?? `oauth_family_${randomUUID()}`;
    let family = this.getFamily(id);
    if (!family) {
      const expiresAt = new Date(createdAt.getTime() + ttlMs).toISOString();
      this.db
        .prepare(
          `INSERT INTO oauth_refresh_families(
            family_id,subject,client_id,status,created_at,expires_at
          ) VALUES(?,?,?,'ACTIVE',?,?)`,
        )
        .run(id, grant.subject, grant.clientId, createdAt.toISOString(), expiresAt);
      family = this.getFamily(id);
    }
    if (
      !family ||
      family.status !== 'ACTIVE' ||
      family.subject !== grant.subject ||
      family.clientId !== grant.clientId ||
      Date.parse(family.expiresAt) <= createdAt.getTime()
    ) {
      throw new Error('invalid refresh token family');
    }
    return this.insertRefreshToken(grant, id, family.expiresAt, createdAt);
  }

  findAccessToken(token: string): OAuthTokenRecord | null {
    const tokenHash = hash(token);
    const row = this.db
      .prepare(`SELECT ${ACCESS_COLUMNS} FROM oauth_access_tokens WHERE token_hash=?`)
      .get(tokenHash) as any | undefined;
    if (!row || !eqHash(tokenHash, String(row.tokenHash))) return null;
    if (Date.parse(row.expiresAt) <= this.now().getTime()) {
      this.db.prepare('DELETE FROM oauth_access_tokens WHERE token_hash=?').run(tokenHash);
      return null;
    }
    return this.accessFromRow(row);
  }

  findRefreshToken(token: string): OAuthRefreshTokenRecord | null {
    const tokenHash = hash(token);
    const row = this.db
      .prepare(`SELECT ${REFRESH_COLUMNS} FROM oauth_refresh_tokens WHERE token_hash=?`)
      .get(tokenHash) as any | undefined;
    if (!row || !eqHash(tokenHash, String(row.tokenHash))) return null;
    if (Date.parse(row.expiresAt) <= this.now().getTime()) {
      this.revokeRefreshFamily(String(row.familyId), 'EXPIRED');
      return null;
    }
    return refreshFromRow(row);
  }

  rotateRefreshTokenSecurely(token: string, _ttlMs: number): RefreshRotationResult {
    const tokenHash = hash(token);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db
        .prepare(`SELECT ${REFRESH_COLUMNS} FROM oauth_refresh_tokens WHERE token_hash=?`)
        .get(tokenHash) as any | undefined;
      if (!row || !eqHash(tokenHash, String(row.tokenHash))) return this.finishInvalid();

      const family = this.getFamily(String(row.familyId));
      if (!family) return this.finishInvalid();
      if (Date.parse(family.expiresAt) <= this.now().getTime()) {
        this.revokeFamilyRows(family.familyId, 'EXPIRED');
        return this.finishInvalid();
      }
      if (String(row.status) === 'SPENT') {
        this.revokeFamilyRows(family.familyId, 'REFRESH_TOKEN_REUSE');
        this.db.prepare('DELETE FROM oauth_access_tokens WHERE subject=?').run(String(row.subject));
        this.revokeConnectionRow(String(row.subject), 'REFRESH_TOKEN_REUSE');
        this.db.exec('COMMIT');
        return { status: 'REPLAYED' };
      }
      if (String(row.status) !== 'ACTIVE' || family.status !== 'ACTIVE') {
        return this.finishInvalid();
      }

      const rotatedAt = this.now();
      const nextToken = secret(32);
      const nextHash = hash(nextToken);
      this.db
        .prepare(
          "UPDATE oauth_refresh_tokens SET status='SPENT',rotated_at=?,replaced_by_hash=? WHERE token_hash=? AND status='ACTIVE'",
        )
        .run(rotatedAt.toISOString(), nextHash, tokenHash);
      const previous = refreshFromRow({
        ...row,
        status: 'SPENT',
        rotatedAt: rotatedAt.toISOString(),
      });
      const nextRecord: OAuthRefreshTokenRecord = {
        ...previous,
        status: 'ACTIVE',
        createdAt: rotatedAt.toISOString(),
        expiresAt: family.expiresAt,
        rotatedAt: undefined,
        revokedAt: undefined,
      };
      this.db
        .prepare(
          `INSERT INTO oauth_refresh_tokens(
            token_hash,family_id,client_id,actor,subject,scope,resource,created_at,expires_at,status
          ) VALUES(?,?,?,?,?,?,?,?,?,'ACTIVE')`,
        )
        .run(
          nextHash,
          nextRecord.familyId,
          nextRecord.clientId,
          nextRecord.actor,
          nextRecord.subject,
          nextRecord.scope,
          nextRecord.resource,
          nextRecord.createdAt,
          nextRecord.expiresAt,
        );
      this.db.exec('COMMIT');
      return { status: 'ROTATED', previous, nextToken };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  revokeRefreshFamily(familyId: string, reason: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.revokeFamilyRows(familyId, reason);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  revokeConnectionCredentials(subject: string, reason: string) {
    const at = this.now().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare(
          "UPDATE oauth_refresh_families SET status='REVOKED',revoked_at=?,revoke_reason=? WHERE subject=? AND status='ACTIVE'",
        )
        .run(at, reason, subject);
      this.db
        .prepare(
          "UPDATE oauth_refresh_tokens SET status='REVOKED',revoked_at=? WHERE subject=? AND status!='REVOKED'",
        )
        .run(at, subject);
      this.db.prepare('DELETE FROM oauth_access_tokens WHERE subject=?').run(subject);
      this.revokeConnectionRow(subject, reason, at);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  revokeToken(token: string) {
    const tokenHash = hash(token);
    this.db.prepare('DELETE FROM oauth_access_tokens WHERE token_hash=?').run(tokenHash);
    this.db
      .prepare(
        "UPDATE oauth_refresh_tokens SET status='REVOKED',revoked_at=? WHERE token_hash=? AND status='ACTIVE'",
      )
      .run(this.now().toISOString(), tokenHash);
  }

  getLatestFamilyForSubject(subject: string): OAuthRefreshFamilyRecord | null {
    const row = this.db
      .prepare(
        `SELECT family_id familyId,subject,client_id clientId,status,created_at createdAt,expires_at expiresAt,
          revoked_at revokedAt,revoke_reason revokeReason
         FROM oauth_refresh_families WHERE subject=? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(subject) as any | undefined;
    if (!row) return null;
    return {
      familyId: String(row.familyId),
      subject: String(row.subject),
      clientId: String(row.clientId),
      status: String(row.status) as OAuthRefreshFamilyRecord['status'],
      createdAt: String(row.createdAt),
      expiresAt: String(row.expiresAt),
      ...(row.revokedAt ? { revokedAt: String(row.revokedAt) } : {}),
      ...(row.revokeReason ? { revokeReason: String(row.revokeReason) } : {}),
    };
  }

  private insertRefreshToken(
    grant: OAuthGrantRecord,
    familyId: string,
    expiresAt: string,
    createdAt: Date,
  ) {
    const token = secret(32);
    const record: OAuthRefreshTokenRecord = {
      ...grant,
      familyId,
      status: 'ACTIVE',
      createdAt: createdAt.toISOString(),
      expiresAt,
    };
    this.db
      .prepare(
        `INSERT INTO oauth_refresh_tokens(
          token_hash,family_id,client_id,actor,subject,scope,resource,created_at,expires_at,status
        ) VALUES(?,?,?,?,?,?,?,?,?,'ACTIVE')`,
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

  private getFamily(familyId: string): OAuthRefreshFamilyRecord | null {
    const row = this.db
      .prepare(
        `SELECT family_id familyId,subject,client_id clientId,status,created_at createdAt,expires_at expiresAt,
          revoked_at revokedAt,revoke_reason revokeReason
         FROM oauth_refresh_families WHERE family_id=?`,
      )
      .get(familyId) as any | undefined;
    if (!row) return null;
    return {
      familyId: String(row.familyId),
      subject: String(row.subject),
      clientId: String(row.clientId),
      status: String(row.status) as OAuthRefreshFamilyRecord['status'],
      createdAt: String(row.createdAt),
      expiresAt: String(row.expiresAt),
      ...(row.revokedAt ? { revokedAt: String(row.revokedAt) } : {}),
      ...(row.revokeReason ? { revokeReason: String(row.revokeReason) } : {}),
    };
  }

  private accessFromRow(row: any): OAuthTokenRecord {
    return {
      clientId: String(row.clientId),
      actor: String(row.actor),
      subject: String(row.subject),
      scope: String(row.scope),
      resource: String(row.resource),
      createdAt: String(row.createdAt),
      expiresAt: String(row.expiresAt),
    };
  }

  private finishInvalid(): RefreshRotationResult {
    this.db.exec('COMMIT');
    return { status: 'INVALID' };
  }

  private revokeFamilyRows(familyId: string, reason: string) {
    const at = this.now().toISOString();
    this.db
      .prepare(
        "UPDATE oauth_refresh_families SET status='REVOKED',revoked_at=?,revoke_reason=? WHERE family_id=?",
      )
      .run(at, reason, familyId);
    this.db
      .prepare(
        "UPDATE oauth_refresh_tokens SET status='REVOKED',revoked_at=? WHERE family_id=? AND status!='REVOKED'",
      )
      .run(at, familyId);
  }

  private revokeConnectionRow(subject: string, reason: string, at = this.now().toISOString()) {
    this.db
      .prepare(
        `UPDATE oauth_connections
         SET status='REVOKED',yolo_enabled=0,revoked_at=?,revoke_reason=?,disconnected_at=NULL,grace_expires_at=NULL,last_used_at=?
         WHERE subject=?`,
      )
      .run(at, reason, at, subject);
  }
}
