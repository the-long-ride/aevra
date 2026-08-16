# 06 — Workspaces & Execution

**Audience:** engineers & AI agents · **Scope:** roots, files, commands, processes · **Verified against:** `0.4.0`

A **workspace** is a registered host folder the AI may work in. Registration happens **only** in the localhost Web UI — the remote surface can never create or mutate roots.

## Roots and paths

- Workspace root + optional external mounts (logical path ↔ host path, per-mount capabilities). The AI sees logical paths only; host absolutes never leave the box.
- Every operation resolves canonically; `..`, symlinks, junctions, reparse points escaping a capability root ⇒ `WORKSPACE_ESCAPE`.
- `file_read` returns a SHA-256 content hash; mutations carry the expected hash. Concurrent edits: Aevra three-way-merges **only provably non-overlapping** changes; overlap ⇒ `MERGE_CONFLICT`, nothing written.

## Command execution

- **Strict sandbox by default**: Docker → Podman → fail (`EXECUTOR_UNAVAILABLE`). Host execution is a separate request with its own approval — never a silent fallback.
- Commands classify into effects: `READ_ONLY` `BUILD_OUTPUT` `SOURCE_MUTATION` `REPOSITORY_STATE` `UNKNOWN`. Read-only may run concurrently; mutations and unknowns take conservative workspace locks; build outputs may overlap when output areas don't conflict.
- Risk + permission rules decide: run, ask (approval ticket), or deny. Aevra never auto-elevates and doesn't run as root/SYSTEM.
- Network egress defaults to deny-all; destinations are explicit allow-rules, capability-gated (`network`).

## Managed processes

Long-running services use `process_start` (not `command_run`): per-workspace ownership, lifecycle `stop-with-aevra` or `keep-running`, bounded + redacted logs via `process_logs`. Remote control requires the owning workspace active; the dashboard sees all records. Post-restart ownership-uncertain records are never auto-signaled.

## Change sets & recovery (short version)

Destructive edits journal intent + snapshots before executing (`change_begin/status/commit/rollback`). After a crash, incomplete operations reconcile into explicit states — `INTERRUPTED`, `EXECUTION_OUTCOME_UNKNOWN`, `RECOVERY_REQUIRED` — and are **never auto-replayed**. Full detail: [`08-audit-recovery`](08-audit-recovery.md).

**Boundaries:** admission/approval mechanics (`02`); recovery internals (`08`).

**Related:** [`02-security-model`](02-security-model.md) · [`../user-manual/07-register-workspace`](../user-manual/07-register-workspace.md)

**Next →** [`07-state-migration`](07-state-migration.md)
