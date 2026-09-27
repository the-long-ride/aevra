export const hostControlMigrations = [
  {
    version: 22,
    name: '022_host_control_grants',
    sql: `
CREATE TABLE IF NOT EXISTS host_control_grants(
  identity_kind TEXT NOT NULL CHECK(identity_kind IN ('oauth','connector')),
  identity_key TEXT NOT NULL,
  capability TEXT NOT NULL CHECK(capability IN ('browser.control','desktop.control')),
  granted_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY(identity_kind,identity_key,capability)
);
`,
  },
  {
    version: 23,
    name: '023_host_control_approvals',
    sql: `
CREATE TABLE pending_approvals_new(
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  session_id TEXT NOT NULL,
  workspace_id TEXT,
  scope TEXT NOT NULL DEFAULT 'workspace' CHECK(scope IN ('workspace','host')),
  identity_kind TEXT,
  identity_key TEXT,
  operation_json TEXT NOT NULL,
  expected_state_json TEXT NOT NULL,
  risk TEXT NOT NULL,
  state TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  cancellation_reason TEXT,
  decision_scope TEXT,
  connection_subject TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((scope='workspace' AND workspace_id IS NOT NULL AND identity_kind IS NULL AND identity_key IS NULL)
    OR (scope='host' AND workspace_id IS NULL AND identity_kind IS NOT NULL AND identity_key IS NOT NULL))
);
INSERT INTO pending_approvals_new(id,actor,session_id,workspace_id,scope,operation_json,expected_state_json,risk,state,expires_at,cancellation_reason,decision_scope,connection_subject,created_at,updated_at)
 SELECT id,actor,session_id,workspace_id,'workspace',operation_json,expected_state_json,risk,state,expires_at,cancellation_reason,decision_scope,connection_subject,created_at,updated_at FROM pending_approvals;
DROP TABLE pending_approvals;
ALTER TABLE pending_approvals_new RENAME TO pending_approvals;
CREATE INDEX idx_pending_approvals_conn_state ON pending_approvals(connection_subject,state);
`,
  },
  {
    version: 24,
    name: '024_host_desktop_access_requests',
    sql: `
CREATE TABLE desktop_access_requests_new(
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  session_id TEXT NOT NULL,
  workspace_id TEXT,
  scope TEXT NOT NULL CHECK(scope IN ('workspace','host')),
  requester_identity_kind TEXT,
  requester_identity_key TEXT,
  window_id TEXT NOT NULL,
  target_executable_path TEXT NOT NULL,
  target_process_id INTEGER NOT NULL,
  target_process_started_at TEXT NOT NULL,
  host_executable_path TEXT NOT NULL,
  host_window_id TEXT NOT NULL,
  host_process_id INTEGER NOT NULL,
  host_process_started_at TEXT NOT NULL,
  requested_duration TEXT NOT NULL CHECK(requested_duration IN ('session','persistent')),
  state TEXT NOT NULL CHECK(state IN ('PENDING','APPROVED','DENIED','EXPIRED')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  decision_scope TEXT,
  decided_by TEXT,
  CHECK((scope='workspace' AND workspace_id IS NOT NULL AND requester_identity_kind IS NULL AND requester_identity_key IS NULL)
    OR (scope='host' AND workspace_id IS NULL AND requester_identity_kind IS NOT NULL AND requester_identity_key IS NOT NULL))
);
INSERT INTO desktop_access_requests_new(id,actor,session_id,workspace_id,scope,window_id,target_executable_path,target_process_id,target_process_started_at,host_executable_path,host_window_id,host_process_id,host_process_started_at,requested_duration,state,expires_at,created_at,updated_at,decision_scope,decided_by)
 SELECT id,actor,session_id,workspace_id,'workspace',window_id,target_executable_path,target_process_id,target_process_started_at,host_executable_path,host_window_id,host_process_id,host_process_started_at,requested_duration,state,expires_at,created_at,updated_at,decision_scope,decided_by FROM desktop_access_requests;
DROP TABLE desktop_access_requests;
ALTER TABLE desktop_access_requests_new RENAME TO desktop_access_requests;
CREATE UNIQUE INDEX idx_desktop_access_pending_dedup
  ON desktop_access_requests(actor,session_id,window_id,target_executable_path,target_process_id,
    target_process_started_at,host_executable_path,host_window_id,host_process_id,host_process_started_at)
  WHERE state='PENDING';
CREATE INDEX idx_desktop_access_requests_pending
  ON desktop_access_requests(state,expires_at,created_at);
`,
  },
];
