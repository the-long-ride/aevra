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
  deleteClient(id: string): 'not_found' | 'active_connections' | 'deleted' {
    if (!this.db.prepare('SELECT 1 FROM oauth_clients WHERE client_id=?').get(id))
      return 'not_found';
    if (
      this.db
        .prepare("SELECT 1 FROM oauth_connections WHERE client_id=? AND status='ACTIVE'")
        .get(id)
    )
      return 'active_connections';
    this.db.prepare('DELETE FROM oauth_clients WHERE client_id=?').run(id);
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
