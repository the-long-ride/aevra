import type { DatabaseSync } from 'node:sqlite';
export const migrations = [
  {
    version: 1,
    name: '001_gateway',
    sql: `
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value_json TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,description TEXT NOT NULL DEFAULT '',host_root TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS external_mounts(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,logical_path TEXT NOT NULL,host_root TEXT NOT NULL,capabilities_json TEXT NOT NULL,sensitivity_policy_id TEXT,UNIQUE(workspace_id,logical_path));
CREATE TABLE IF NOT EXISTS capability_profiles(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,capabilities_json TEXT NOT NULL,builtin INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS actor_workspace_profiles(actor TEXT NOT NULL,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,profile_id TEXT NOT NULL,admission TEXT NOT NULL,PRIMARY KEY(actor,workspace_id));
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,actor TEXT NOT NULL,subject TEXT NOT NULL,created_at TEXT NOT NULL,last_activity_at TEXT NOT NULL,remote_ip TEXT,valid INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS workspace_leases(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,actor TEXT NOT NULL,capabilities_json TEXT NOT NULL,expires_at TEXT NOT NULL,valid INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS permission_rules(id TEXT PRIMARY KEY,effect TEXT NOT NULL,capability TEXT NOT NULL,scope TEXT NOT NULL,workspace_id TEXT,actor TEXT,matcher TEXT NOT NULL,created_at TEXT NOT NULL,last_used_at TEXT,expires_at TEXT);
CREATE TABLE IF NOT EXISTS pending_approvals(id TEXT PRIMARY KEY,actor TEXT NOT NULL,session_id TEXT NOT NULL,workspace_id TEXT NOT NULL,operation_json TEXT NOT NULL,expected_state_json TEXT NOT NULL,risk TEXT NOT NULL,state TEXT NOT NULL,expires_at TEXT NOT NULL,cancellation_reason TEXT,decision_scope TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,session_id TEXT,workspace_id TEXT,kind TEXT NOT NULL,state TEXT NOT NULL,intent_json TEXT NOT NULL,expected_state_json TEXT NOT NULL DEFAULT '{}',result_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS change_sets(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,owner_session_id TEXT NOT NULL,name TEXT,state TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS change_operations(id INTEGER PRIMARY KEY AUTOINCREMENT,change_set_id TEXT NOT NULL REFERENCES change_sets(id) ON DELETE CASCADE,operation_id TEXT NOT NULL,logical_path TEXT,before_hash TEXT,after_hash TEXT,snapshot_path TEXT,metadata_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS recovery_entries(id TEXT PRIMARY KEY,change_set_id TEXT NOT NULL REFERENCES change_sets(id) ON DELETE CASCADE,logical_path TEXT NOT NULL,snapshot_path TEXT,size_bytes INTEGER NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS managed_processes(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,lifecycle TEXT NOT NULL,ownership TEXT NOT NULL,helper_pid INTEGER,helper_started_at TEXT,marker TEXT,command_json TEXT NOT NULL,execution_mode TEXT NOT NULL,log_path TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS environment_profiles(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,vars_json TEXT NOT NULL,secret_refs_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS secret_references(id TEXT PRIMARY KEY,backend TEXT NOT NULL,key_ref TEXT NOT NULL,metadata_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS command_family_overrides(family TEXT PRIMARY KEY,effect TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS network_rules(id TEXT PRIMARY KEY,effect TEXT NOT NULL,scope TEXT NOT NULL,workspace_id TEXT,actor TEXT,protocol TEXT NOT NULL,host TEXT NOT NULL,port INTEGER NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_sessions(id_hash TEXT PRIMARY KEY,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,last_used_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bootstrap_tokens(token_hash TEXT PRIMARY KEY,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,consumed_at TEXT);
CREATE TABLE IF NOT EXISTS audit_chain_checkpoints(id INTEGER PRIMARY KEY CHECK(id=1),previous_hash TEXT NOT NULL,event_id TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_events(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,event_json TEXT NOT NULL,previous_hash TEXT NOT NULL,content_hash TEXT NOT NULL,class TEXT NOT NULL DEFAULT 'normal');
`,
  },
  {
    version: 2,
    name: '002_session_permission_scope',
    sql: `ALTER TABLE permission_rules ADD COLUMN session_id TEXT;`,
  },
  {
    version: 3,
    name: '003_connectors',
    sql: `
CREATE TABLE IF NOT EXISTS connectors(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,token_hash TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,last_used_at TEXT);
`,
  },
  {
    version: 4,
    name: '004_connector_bindings_rotation',
    sql: `
ALTER TABLE connectors ADD COLUMN workspace_id TEXT;
ALTER TABLE connectors ADD COLUMN profile_cap TEXT;
ALTER TABLE connectors ADD COLUMN expires_at TEXT;
ALTER TABLE connectors ADD COLUMN previous_token_hash TEXT;
ALTER TABLE connectors ADD COLUMN previous_expires_at TEXT;
`,
  },
  {
    version: 5,
    name: '005_oauth',
    sql: `
CREATE TABLE IF NOT EXISTS oauth_clients(
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  redirect_uris_json TEXT NOT NULL,
  token_endpoint_auth_method TEXT NOT NULL,
  grant_types_json TEXT NOT NULL,
  response_types_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_authorization_requests(
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL,
  oauth_state TEXT,
  remote_ip TEXT,
  pairing_code TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_oauth_authorization_requests_status ON oauth_authorization_requests(status,expires_at);
CREATE TABLE IF NOT EXISTS oauth_authorization_codes(
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  actor TEXT NOT NULL,
  subject TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_access_tokens(
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  subject TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_expires ON oauth_access_tokens(expires_at);
CREATE TABLE IF NOT EXISTS oauth_refresh_tokens(
  token_hash TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  subject TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_expires ON oauth_refresh_tokens(expires_at);
`,
  },
];
export function applyMigrations(db: DatabaseSync) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL)',
  );
  for (const m of migrations) {
    const row = db.prepare('SELECT version FROM schema_migrations WHERE version=?').get(m.version);
    if (row) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)').run(
        m.version,
        m.name,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}
