# 07 — State & Schema

**Audience:** engineers & AI agents · **Scope:** on-disk state and schema evolution · **Verified against:** `0.1.3`

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

Migrations are applied transactionally and recorded in `schema_migrations`. Existing Aevra databases advance in version order; new databases receive the complete schema.

## Startup state behavior

Aevra creates its configured state and recovery directories when needed, then opens `aevra.db` and runs integrity checks. It does not discover, copy, rename, or modify state from other products.

**Boundaries:** backups and crash recovery are covered in `08`; runtime configuration is covered in `09`.

**Related:** [`08-audit-recovery`](08-audit-recovery.md) · [`09-configuration`](09-configuration.md)

**Next →** [`08-audit-recovery`](08-audit-recovery.md)
