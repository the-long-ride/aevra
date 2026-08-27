# 06 — Workspaces & Execution

**Audience:** engineers & AI agents · **Scope:** roots, files, commands, processes · **Verified against:** `Unreleased`

A **workspace** is a registered host folder the AI may work in. Registration happens **only** in the localhost Web UI — the remote surface can never create or mutate roots.

## Roots and paths

- Workspace root + optional external mounts (logical path ↔ host path, per-mount capabilities). The AI sees logical paths only; host absolutes never leave the box.
- Every operation resolves canonically; `..`, symlinks, junctions, reparse points escaping a capability root ⇒ `WORKSPACE_ESCAPE`.
- `file_read_many` is the model-facing read interface for one or more files. Each successful read preserves the ordinary file-read metadata, including SHA-256 content hashes used for conflict-aware mutation flows.
- `file_write_many` is the model-facing mutation interface for create, replace, and patch operations. Replace/patch items can carry the expected hash, and concurrent edits still three-way-merge **only provably non-overlapping** changes; overlap ⇒ `MERGE_CONFLICT`, nothing written.

## Batched file execution

The model-facing file tools batch even single-item work so clients do not need to choose between singular and batch APIs:

- `file_read_many`: one to 32 reads, bounded concurrency, input-order results, and per-item failures rather than failing unrelated reads.
- `file_write_many`: one to 32 creates/replacements/patches. The write item schema is discriminated by `operation`, so irrelevant fields are rejected instead of silently ignored.
- Duplicate write paths are rejected before any mutation dispatch.
- Every individual mutation delegates through the same security-sensitive primitive used by singular internal operations, preserving approvals, sensitivity handling, recovery journaling, conflict detection, and workspace mutation locks.

The singular primitives `file_read`, `file_create`, `file_write`, and `file_patch` remain internal implementation operations and are not advertised through MCP `tools/list`.

## Command execution

- **Strict sandbox by default**: Docker → Podman → fail (`EXECUTOR_UNAVAILABLE`). Host execution is a separate request with its own approval — never a silent fallback.
- Commands classify into effects: `READ_ONLY` `BUILD_OUTPUT` `SOURCE_MUTATION` `REPOSITORY_STATE` `UNKNOWN`. Read-only may run concurrently; mutations and unknowns take conservative workspace locks; build outputs may overlap when output areas don't conflict.
- Risk + permission rules decide: run, ask (approval ticket), or deny. Aevra never auto-elevates and doesn't run as root/SYSTEM.
- Network egress defaults to deny-all; destinations are explicit allow-rules, capability-gated (`network`).
- `command_run_many` is the model-facing bounded command interface for one to 16 commands, including a single command. Aevra uses bounded concurrency for compatible effects and serializes potentially conflicting work. The singular `command_run` primitive remains internal/non-discoverable.
- If a command may exceed the upstream tool-request window, use a managed process instead of extending one MCP HTTP response indefinitely.

## Managed processes

Long-running work uses `process_start`: per-workspace ownership, lifecycle `stop-with-aevra` or `keep-running`, bounded + redacted logs, and a durable process ID that can be queried from later MCP calls.

The observable process state is:

- `running`
- `completed` — normal exit code `0`
- `failed` — non-zero/abnormal completion
- `stopped` — Aevra explicitly requested termination
- `unknown` — persisted ownership exists but the current runtime cannot prove a terminal state

`process_status` returns one snapshot. `process_wait` performs a bounded wait of at most 30 seconds and returns the current snapshot; a still-running result is normal and can be polled again. `process_logs` returns incremental log lines plus state/exit metadata and `eof`. `process_list` exposes the same terminal fields across workspace-owned processes.

Terminal status includes `exitCode`, `signal`, `finishedAt`, and `durationMs`. This lets a remote AI distinguish “logs stopped arriving” from “the command completed successfully.”

For detached `keep-running` processes, the process host writes an atomic result sidecar when the child exits so completion remains observable after the detached helper finishes. Core persists observed terminal state in SQLite. Remote control still requires the owning workspace active; the dashboard sees all records. Post-worker-restart ownership-uncertain records are never auto-signaled or blindly re-adopted.

## Keep-awake policy

The persisted `power.keepAwake` setting supports `off`, `remote-connections` (default), `managed-processes`, and `always`. Aevra evaluates the selected policy every 5 seconds and uses a platform sleep inhibitor only while needed. Windows uses `SetThreadExecutionState`, macOS uses `caffeinate`, and Linux uses a logind inhibitor. The policy prevents system idle sleep only; it does **not** force the display on or disable screen locking. Unsupported platforms degrade to an explicit unavailable status rather than failing startup.

## Change sets & recovery (short version)

Destructive edits journal intent + snapshots before executing (`change_begin/status/commit/rollback`). After a crash, incomplete operations reconcile into explicit states — `INTERRUPTED`, `EXECUTION_OUTCOME_UNKNOWN`, `RECOVERY_REQUIRED` — and are **never auto-replayed**. Full detail: [`08-audit-recovery`](08-audit-recovery.md).

**Boundaries:** admission/approval mechanics (`02`); recovery internals (`08`).

**Related:** [`02-security-model`](02-security-model.md) · [`../user-manual/07-workspaces`](../user-manual/07-workspaces.md)

**Next →** [`07-state-migration`](07-state-migration.md)
