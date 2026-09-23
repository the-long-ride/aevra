export const upstreamAuthPolicyMigrations = [
  {
    version: 11,
    name: '011_mcp_upstreams',
    sql: `
CREATE TABLE IF NOT EXISTS mcp_upstreams(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  transport TEXT NOT NULL,
  config_json TEXT NOT NULL,
  auth_json TEXT NOT NULL DEFAULT '{}',
  risk TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  catalog_fingerprint TEXT,
  state TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL);
`,
  },
  {
    version: 12,
    name: '012_mcp_upstream_catalog_review',
    sql: `
ALTER TABLE mcp_upstreams ADD COLUMN catalog_json TEXT;
    ALTER TABLE mcp_upstreams ADD COLUMN pending_catalog_diff_json TEXT;
`,
  },
  {
    version: 13,
    name: '013_mcp_upstream_pending_catalog',
    sql: `
ALTER TABLE mcp_upstreams ADD COLUMN pending_catalog_json TEXT;
`,
  },
  {
    version: 14,
    name: '014_oauth_continuity_ownership_and_origins',
    sql: `
ALTER TABLE pending_approvals ADD COLUMN connection_subject TEXT;
CREATE TABLE IF NOT EXISTS oauth_connection_origins(
  subject TEXT NOT NULL,
  remote_ip TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY(subject, remote_ip)
);
CREATE INDEX IF NOT EXISTS idx_pending_approvals_conn_state ON pending_approvals(connection_subject, state);
CREATE INDEX IF NOT EXISTS idx_oauth_connection_origins_subject_seen ON oauth_connection_origins(subject, last_seen_at);
`,
  },
  {
    version: 15,
    name: '015_oauth_renewable_grants',
    sql: `
ALTER TABLE oauth_authorization_requests ADD COLUMN renewable INTEGER NOT NULL DEFAULT 1;
ALTER TABLE oauth_authorization_codes ADD COLUMN renewable INTEGER NOT NULL DEFAULT 1;
`,
  },
  {
    version: 16,
    name: '016_command_rule_v2_predicates',
    sql: `
ALTER TABLE permission_rules ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE permission_rules ADD COLUMN predicate_json TEXT;
ALTER TABLE permission_rules ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
`,
  },
];
