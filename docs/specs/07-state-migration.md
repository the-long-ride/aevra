# 07 — State & Schema

**Audience:** engineers & AI agents · **Scope:** on-disk state and schema evolution · **Verified against:** `0.1.0`

## State directory

| Platform | Default                                           |
| -------- | ------------------------------------------------- |
| Windows  | `%LOCALAPPDATA%\Aevra`                            |
| macOS    | `~/Library/Application Support/Aevra`             |
| Linux    | `$XDG_STATE_HOME/aevra` or `~/.local/state/aevra` |

`AEVRA_STATE_DIR` overrides the default location. Contents include `aevra.db` (SQLite, WAL), `local-control.secret`, `recovery/`, `secrets.vault`, `backups/`, and `worker.sock` on POSIX.

## Schema

`node:sqlite` uses ordered migrations in `packages/store/src/migrations.ts`:

- **v1 `001_gateway`** — workspaces, mounts, capability profiles, actor/workspace mappings, sessions, leases, permission rules, pending approvals, operations, change sets, recovery entries, managed processes, environment profiles, secret refs, command-family overrides, network rules, admin sessions, bootstrap tokens, audit chain.
- **v2 `002_session_permission_scope`** — session-scoped permission rules.
- **v3 `003_connectors`** — connectors table.
- **v4 `004_connector_bindings_rotation`** — connector workspace/profile bindings, expiry, and token-rotation grace fields.

Migrations are applied transactionally and recorded in `schema_migrations`. Existing Aevra databases advance in version order; new databases receive the complete schema.

## Startup state behavior

Aevra creates its configured state and recovery directories when needed, then opens `aevra.db` and runs integrity checks. It does not discover, copy, rename, or modify state from other products.

**Boundaries:** backups and crash recovery are covered in `08`; runtime configuration is covered in `09`.

**Related:** [`08-audit-recovery`](08-audit-recovery.md) · [`09-configuration`](09-configuration.md)

**Next →** [`08-audit-recovery`](08-audit-recovery.md)
