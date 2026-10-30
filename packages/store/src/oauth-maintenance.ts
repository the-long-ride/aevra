import type { DatabaseSync } from 'node:sqlite';

export class OAuthMaintenance {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => Date,
  ) {}
  countUnconnectedClients() {
    return Number(
      (
        this.db
          .prepare(
            'SELECT count(*) count FROM oauth_clients c WHERE NOT EXISTS (SELECT 1 FROM oauth_connections o WHERE o.client_id=c.client_id)',
          )
          .get() as { count: number }
      ).count,
    );
  }
  pruneUnconnectedClients(maxAgeMs: number) {
    return Number(
      this.db
        .prepare(
          'DELETE FROM oauth_clients WHERE created_at < ? AND NOT EXISTS (SELECT 1 FROM oauth_connections o WHERE o.client_id=oauth_clients.client_id)',
        )
        .run(new Date(this.now().getTime() - maxAgeMs).toISOString()).changes,
    );
  }
  deleteClient(id: string, force = false): 'not_found' | 'active_connections' | 'deleted' {
    let clientId = id;
    let byName = false;
    let row = this.db.prepare('SELECT client_id FROM oauth_clients WHERE client_id=?').get(id) as
      { client_id: string } | undefined;
    if (!row) {
      row = this.db.prepare('SELECT client_id FROM oauth_clients WHERE client_name=?').get(id) as
        { client_id: string } | undefined;
      if (!row) return 'not_found';
      clientId = row.client_id;
      byName = true;
    }
    const hasActive = byName
      ? Boolean(
          this.db
            .prepare(
              "SELECT 1 FROM oauth_connections WHERE client_id IN (SELECT client_id FROM oauth_clients WHERE client_name=?) AND status='ACTIVE'",
            )
            .get(id),
        )
      : Boolean(
          this.db
            .prepare("SELECT 1 FROM oauth_connections WHERE client_id=? AND status='ACTIVE'")
            .get(clientId),
        );
    if (hasActive) {
      if (!force) return 'active_connections';
      if (byName) {
        this.db
          .prepare(
            "UPDATE oauth_connections SET status='REVOKED', revoked_at=?, revoke_reason='CLIENT_DELETED' WHERE client_id IN (SELECT client_id FROM oauth_clients WHERE client_name=?) AND status='ACTIVE'",
          )
          .run(this.now().toISOString(), id);
      } else {
        this.db
          .prepare(
            "UPDATE oauth_connections SET status='REVOKED', revoked_at=?, revoke_reason='CLIENT_DELETED' WHERE client_id=? AND status='ACTIVE'",
          )
          .run(this.now().toISOString(), clientId);
      }
    }
    if (byName) {
      this.db.prepare('DELETE FROM oauth_clients WHERE client_name=?').run(id);
    } else {
      this.db.prepare('DELETE FROM oauth_clients WHERE client_id=?').run(clientId);
    }
    return 'deleted';
  }
  trimPendingAuthorizationRequests(clientId: string, keep: number) {
    return Number(
      this.db
        .prepare(
          "DELETE FROM oauth_authorization_requests WHERE client_id=? AND status='PENDING' AND (expires_at<=? OR id NOT IN (SELECT id FROM oauth_authorization_requests WHERE client_id=? AND status='PENDING' AND expires_at>? ORDER BY created_at DESC,rowid DESC LIMIT ?))",
        )
        .run(clientId, this.now().toISOString(), clientId, this.now().toISOString(), keep).changes,
    );
  }
}
