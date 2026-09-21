# 08 — Audit & Recovery

**Audience:** engineers & AI agents · **Scope:** audit chain, change sets, safe mode, crash semantics · **Verified against:** `1.1.0`

## Audit chain

Every significant action appends a redacted event to `audit_events` with `previous_hash` and `content_hash` — a tamper-evident chain, checkpointed in `audit_chain_checkpoints`. The Web UI can **verify the chain** and export redacted JSON/JSONL. Secrets and credential-shaped strings are DLP-masked before anything is persisted or returned. Desktop input and set values (`desktop_set_value`, `desktop_type`) are redacted from audit events (preserving only value length and nonce), and screenshot captures are audited strictly by SHA-256 content hash without storing raw pixels.

## Change sets

`file_write/patch/move/delete` and similar mutations run inside an optional change set (`change_begin` → work → `change_commit` or `change_rollback`):

- **Before** a destructive mutation: intent + recovery state persisted (operation row, before-hash, snapshot under `recovery/`, bounded by retention/size limits).
- **Rollback** validates current hashes and refuses to silently overwrite newer changes.
- Journaling is independent of Git — recovery works even without a repo.

## Crash semantics — never guess

On restart, incomplete mutating operations are reconciled into explicit states:

| State                       | Meaning                             |
| --------------------------- | ----------------------------------- |
| `INTERRUPTED`               | stopped before execution            |
| `EXECUTION_OUTCOME_UNKNOWN` | worker died mid-execution           |
| `RECOVERY_REQUIRED`         | snapshots exist; rollback available |

They are **never automatically replayed**. The client or dashboard decides.

## Durable operation inspection

Mutating operation records are connection-scoped when the caller is OAuth-authenticated. After a transport loss, the same logical OAuth connection can query `operation_get` or bounded `operation_list` results to determine whether a write, commit, delete, or command completed. Unknown/revoked connections and unrelated sessions cannot inspect those records. This is observation, not replay: Aevra never retries a mutation merely because its response was lost.

## Safe mode

Startup validates DB integrity (`PRAGMA integrity_check`). Failure ⇒ **SAFE MODE**: admin dashboard stays up for diagnostics/export/recovery; both MCP paths return `503 {"error":"SAFE_MODE"}`; all administrative mutations are blocked. Recovery is deliberate, never automatic.

## Backups & data migration

- **Database snapshots:** `VACUUM INTO`-based consistent snapshots to `backups/` (never a blind copy of a live WAL database), bounded retention.
- **Data export & import (`/api/data/export`):** Operators can download a structured JSON archive of their Aevra configuration (workspaces, external mounts, permission rules, command-family overrides, network rules, environment profiles, secret reference metadata, lifecycle hooks, MCP upstream server definitions, desktop policy, and custom application records). Machine-local environment variables and device-bound raw secrets are strictly omitted to protect host credentials during migration.
- **Data restore:** The Web UI `Data` tab validates imported JSON payloads, renders pre-flight entity counts for inspection, and restores records transactionally without bypassing schema constraints.

**Boundaries:** approval policy (`02`); snapshot file formats are internal.

**Related:** [`02-security-model`](02-security-model.md) · [`06-workspaces-execution`](06-workspaces-execution.md) · [`../user-manual/12-troubleshooting`](../user-manual/12-troubleshooting.md)

**Next →** [`09-configuration`](09-configuration.md)
