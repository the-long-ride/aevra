import type { DatabaseSync } from 'node:sqlite';

export type HostControlCapability = 'browser.control' | 'desktop.control';
export type HostControlIdentity = { kind: 'oauth' | 'connector' | 'session'; key: string };
export type HostControlGrant = {
  identity: HostControlIdentity;
  capability: HostControlCapability;
  grantedBy: string;
  createdAt: string;
  revokedAt: string | null;
};

function validCapability(value: string): value is HostControlCapability {
  return value === 'browser.control' || value === 'desktop.control';
}
function validate(identity: HostControlIdentity, capability: string) {
  if (
    !identity.key ||
    !['oauth', 'connector', 'session'].includes(identity.kind) ||
    !validCapability(capability)
  ) {
    throw new Error('HOST_CONTROL_GRANT_INVALID');
  }
}

export class HostControlGrantRepository {
  private sessionGrants = new Map<string, HostControlGrant>();
  constructor(private db: DatabaseSync) {}
  private key(identity: HostControlIdentity, capability: HostControlCapability) {
    return `${identity.kind}:${identity.key}:${capability}`;
  }
  get(identity: HostControlIdentity, capability: HostControlCapability): HostControlGrant | null {
    validate(identity, capability);
    if (identity.kind === 'session')
      return this.sessionGrants.get(this.key(identity, capability)) ?? null;
    const row = this.db
      .prepare(
        'SELECT * FROM host_control_grants WHERE identity_kind=? AND identity_key=? AND capability=?',
      )
      .get(identity.kind, identity.key, capability) as any;
    return row
      ? {
          identity,
          capability,
          grantedBy: row.granted_by,
          createdAt: row.created_at,
          revokedAt: row.revoked_at,
        }
      : null;
  }
  upsert(
    identity: HostControlIdentity,
    capability: HostControlCapability,
    grantedBy: string,
  ): HostControlGrant {
    validate(identity, capability);
    if (!grantedBy) throw new Error('HOST_CONTROL_GRANT_INVALID');
    const createdAt = new Date().toISOString();
    const grant = { identity, capability, grantedBy, createdAt, revokedAt: null };
    if (identity.kind === 'session') this.sessionGrants.set(this.key(identity, capability), grant);
    else
      this.db
        .prepare(
          `INSERT INTO host_control_grants(identity_kind,identity_key,capability,granted_by,created_at,revoked_at) VALUES(?,?,?,?,?,NULL)
      ON CONFLICT(identity_kind,identity_key,capability) DO UPDATE SET granted_by=excluded.granted_by,created_at=excluded.created_at,revoked_at=NULL`,
        )
        .run(identity.kind, identity.key, capability, grantedBy, createdAt);
    return grant;
  }
  revoke(identity: HostControlIdentity, capability: HostControlCapability): boolean {
    validate(identity, capability);
    const current = this.get(identity, capability);
    if (!current || current.revokedAt) return false;
    const revokedAt = new Date().toISOString();
    if (identity.kind === 'session')
      this.sessionGrants.set(this.key(identity, capability), { ...current, revokedAt });
    else
      this.db
        .prepare(
          'UPDATE host_control_grants SET revoked_at=? WHERE identity_kind=? AND identity_key=? AND capability=?',
        )
        .run(revokedAt, identity.kind, identity.key, capability);
    return true;
  }
  list(identity: HostControlIdentity): HostControlGrant[] {
    if (identity.kind === 'session')
      return [...this.sessionGrants.values()].filter((x) => x.identity.key === identity.key);
    const rows = this.db
      .prepare(
        'SELECT capability FROM host_control_grants WHERE identity_kind=? AND identity_key=? ORDER BY capability',
      )
      .all(identity.kind, identity.key) as { capability: HostControlCapability }[];
    return rows.map((row) => this.get(identity, row.capability)!);
  }
}
