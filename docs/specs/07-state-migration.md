# 07 — State & Schema

**Audience:** engineers & AI agents · **Scope:** on-disk state and schema evolution · **Verified against:** `1.2.0`

## State directory

| Platform | Default                                           |
| -------- | ------------------------------------------------- |
| Windows  | `%LOCALAPPDATA%\Aevra`                            |
| macOS    | `~/Library/Application Support/Aevra`             |
| Linux    | `$XDG_STATE_HOME/aevra` or `~/.local/state/aevra` |

`AEVRA_STATE_DIR` overrides the default location. Contents include `aevra.db` (SQLite, WAL), `local-control.secret`, `recovery/`, `secrets.vault`, `backups/`, and `worker.sock` on POSIX.

## Schema

`node:sqlite` uses ordered migrations in `packages/store/src/migrations.ts`:

- **v1 `001_gateway`** - workspaces, mounts, profiles, sessions/leases, permissions, approvals, operations, recovery, managed processes, settings, secrets, and audit.
- **v2 `002_session_permission_scope`** - session-scoped permission rules.
- **v3 `003_connectors`** - static connector credentials.
- **v4 `004_connector_bindings_rotation`** - connector bindings, expiry, and rotation grace.
- **v5 `005_oauth`** - OAuth clients, authorization requests/codes, access tokens, and refresh tokens.
- **v6** - durable managed-process terminal state (state, exit code, signal, finish/failure metadata).
- **v7 `007_managed_process_name`** - optional human-readable managed-process names.
- **v8 `008_oauth_workspace_grants`** - connection-subject remembered workspace/profile grants.
- **v9 `009_oauth_connection_continuity`** - durable OAuth connections, reconnect grace, connection YOLO, refresh-token families, and rotation/revocation state.
- **v10 `010_operation_connection_scope`** - associates durable operations with the owning OAuth connection for safe post-reconnect inspection.
- **v11 `011_mcp_upstreams`** - upstream server registration, config, and catalog state.
- **v12 `012_mcp_upstream_catalog_review`** - catalog diff reviews.
- **v13 `013_mcp_upstream_pending_catalog`** - pending catalog updates.
- **v14 `014_oauth_continuity_ownership_and_origins`** - pending approval connection subject association and bounded runner origin tracking (`oauth_connection_origins`).
- **v15 `015_oauth_renewable_grants`** - renewable flags on authorization requests and codes.
- **v16 `016_command_rule_v2_predicates`** - typed command rule predicates (`version`, `predicate_json`, `status`) on `permission_rules`.
- **v17 `017_control_plan_journal`** - owner/request-bound control plans and redacted per-step dispatch-state journal.
- **v18 `018_control_plan_terminal_results`** - sanitized terminal control-plan summaries for restart-safe idempotent reattachment.
- **v19 `019_desktop_access_requests`** - desktop app grants (`desktop_app_grants`) and access requests (`desktop_access_requests`).
- **v20 `020_desktop_custom_apps`** - custom desktop applications catalog (`desktop_custom_apps`).
- **v21 `021_desktop_access_request_host_binding`** - desktop access requests host process and session binding.
- **v22 `022_host_control_grants`** - persistent host-level control grants (`host_control_grants`) for browser/desktop capabilities keyed by identity.
- **v23 `023_host_control_approvals`** - host-scoped pending approvals table migration (`pending_approvals_new` -> `pending_approvals`).
- **v24 `024_host_desktop_access_requests`** - host-scoped desktop access requests (`desktop_access_requests_new` -> `desktop_access_requests`).
- **v25 `025_token_usage`** - token usage accounting table (`token_usage`, `WITHOUT ROWID`, PK `(granularity, bucket, connector, tool)`).

Migrations are applied transactionally and recorded in `schema_migrations`. Existing Aevra databases advance in version order; new databases receive the complete schema.

## Token usage storage

Migration 25 introduces `token_usage` for lightweight, privacy-preserving token accounting:

- **Schema:** `token_usage(granularity, bucket, connector, tool, calls, errors, input_tokens, output_tokens, saved_tokens, duration_ms)` with composite primary key `(granularity, bucket, connector, tool) WITHOUT ROWID`.
- **Bucketing:** `granularity = 'hour'` uses UTC `YYYY-MM-DDTHH`; `granularity = 'day'` uses host-local `YYYY-MM-DD`.
- **Accumulator & Flush:** In-memory counters accumulate live requests and flush to SQLite every 30 seconds and upon shutdown.
- **Roll-up:** Hourly records older than 7 days are automatically aggregated into local day rows and purged, keeping storage footprint bounded (~1.5 MB/year) while preserving lifetime historical trends. No arguments, file contents, or paths are ever persisted.

## Startup state behavior

Aevra creates its configured state and recovery directories when needed, then opens `aevra.db` and runs integrity checks. It does not discover, copy, rename, or modify state from other products.

**Boundaries:** backups and crash recovery are covered in `08`; runtime configuration is covered in `09`.

**Related:** [`08-audit-recovery`](08-audit-recovery.md) · [`09-configuration`](09-configuration.md) · [`11-token-efficiency-and-usage`](11-token-efficiency-and-usage.md)

**Next →** [`08-audit-recovery`](08-audit-recovery.md)
