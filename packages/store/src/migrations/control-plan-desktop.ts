export const controlPlanDesktopMigrations = [
  {
    version: 17,
    name: '017_control_plan_journal',
    sql: `
CREATE TABLE IF NOT EXISTS control_plans(
  plan_id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  request_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  cancelled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner,request_id)
);
CREATE INDEX IF NOT EXISTS idx_control_plans_owner_updated ON control_plans(owner,updated_at);
CREATE TABLE IF NOT EXISTS control_plan_steps(
  plan_id TEXT NOT NULL REFERENCES control_plans(plan_id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  action TEXT NOT NULL,
  dispatch_state TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(plan_id,step_id,attempt_id)
);
`,
  },
  {
    version: 18,
    name: '018_control_plan_terminal_results',
    sql: `ALTER TABLE control_plans ADD COLUMN result_json TEXT;`,
  },
  {
    version: 19,
    name: '019_desktop_access_requests',
    sql: `
CREATE TABLE IF NOT EXISTS desktop_app_grants(
  id TEXT PRIMARY KEY,
  executable_path TEXT NOT NULL,
  path_key TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  session_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_desktop_app_grants_path_scope
  ON desktop_app_grants(path_key,scope_key);
CREATE TABLE IF NOT EXISTS desktop_access_requests(
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  session_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
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
  decided_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_desktop_access_pending_dedup
  ON desktop_access_requests(actor,session_id,window_id,target_process_id,target_process_started_at,
    host_executable_path,host_process_id,host_process_started_at)
  WHERE state='PENDING';
CREATE INDEX IF NOT EXISTS idx_desktop_access_requests_pending
  ON desktop_access_requests(state,expires_at,created_at);
`,
  },
  {
    version: 20,
    name: '020_desktop_custom_apps',
    sql: `
CREATE TABLE IF NOT EXISTS desktop_custom_apps(
  id TEXT PRIMARY KEY,
  path_key TEXT NOT NULL UNIQUE,
  executable_path TEXT NOT NULL,
  display_name TEXT NOT NULL,
  version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
  {
    version: 21,
    name: '021_desktop_access_request_host_binding',
    sql: `
DROP INDEX IF EXISTS idx_desktop_access_pending_dedup;
CREATE UNIQUE INDEX idx_desktop_access_pending_dedup
  ON desktop_access_requests(actor,session_id,window_id,target_executable_path,target_process_id,
    target_process_started_at,host_executable_path,host_window_id,host_process_id,host_process_started_at)
  WHERE state='PENDING';
`,
  },
];
