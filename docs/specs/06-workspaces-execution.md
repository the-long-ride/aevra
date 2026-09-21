# 06 — Workspaces & Execution

**Audience:** engineers & AI agents · **Scope:** roots, files, commands, processes · **Verified against:** `1.1.0`

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

## Workspace manifest (`aevra.json`)

An optional `<workspaceRoot>/aevra.json` may declare literal command suggestions
(`test`, `build`, `lint`, `run`) and protected path patterns in
`protectedPaths.sensitive` and `protectedPaths.secret`. The manifest is parsed
and cached by file metadata, includes an implicit sensitive rule for itself,
and returns a visible warning with safe defaults when it is missing, malformed,
oversized, or contains an invalid glob. Secret patterns are evaluated before
sensitive patterns so the stricter class cannot be shadowed.

Commands are advisory untrusted text. If a client chooses to run one, it still
uses the normal `shell_run` policy, risk tier, and approval path. Protected
patterns feed the existing file-resource sensitivity classifier, including
search hits, so secret matches are denied and sensitive mutations require
approval. This release intentionally does not expand the manifest boundary to
shell command contents; `shell_run cat protected/file` remains governed by
command policy rather than file-resource classification.

## Command execution & system capabilities

- **Strict sandbox by default**: Docker → Podman → fail (`EXECUTOR_UNAVAILABLE`). Host execution is a separate request with its own approval — never a silent fallback.
- **Host system capabilities & shell resolution**: Aevra probes host OS information, available shells (`pwsh`, `powershell`, `cmd`, `bash`, `zsh`, `sh`, `wsl`), and installed toolchain categories (Git, GitHub CLI `gh`, GitLab CLI `glab`, JavaScript, Python, .NET, Rust, Go, JVM, Ruby, PHP, native build tools including `rtk`, container runtimes). `shell_run` automatically resolves an unspecified shell to the platform's recommended shell (`pwsh`/`powershell` on Windows, `bash`/`zsh` on unix-like systems).
- **Structured command understanding (`packages/command-analysis`)**: Commands are parsed into semantic syntax graphs with nodes, options, modifiers, and targets across PowerShell, CMD, Bash, sh, and zsh. Wrappers such as `rtk` are recognized and mapped to underlying tools without dropping arguments or flags.
- **Canonical workspace scope & cwdLogical**: Commands and processes accept optional `cwdLogical`, resolved in Aevra's logical namespace against authorized capability roots. Raw absolute command operands keep native host semantics; relative operands resolve from the mapped logical cwd. This separation prevents logical `/` from being mistaken for the host filesystem root. Any command whose working directory or canonical targets escape authorized workspace roots (`OUTSIDE_WORKSPACE`) strictly prompts for human approval in ordinary and workspace YOLO modes.
- **Scope-bearing syntax is explicit**: shell redirects, Bash background lists, copy/move destination options, grep/ripgrep pattern-file options, touch references, find input lists, Git cwd controls, and Node-package cwd controls are included in containment evidence. Unsupported or malformed scope-bearing syntax fails closed instead of disappearing from authorization.
- **Package script evidence follows the effective package cwd**: npm/pnpm/yarn/bun `--prefix`, `--dir`, and `-C` are canonicalized once, including external mounts, before reading `package.json` and fingerprinting named scripts.
- **Bound executable identity & batch shim safety**: Host command analysis resolves the actual invocation with the request child environment via `packages/command-analysis/src/executable-resolver.ts`; execution prepares Windows launch targets in `packages/executor/src/spawn-target.ts`. Both paths receive the effective child environment, explicit paths and PATH overrides are preserved, wrapper identities are fingerprinted separately, and sandbox analysis fails closed instead of substituting host executable evidence. On Windows, `.cmd`/`.bat` shims are wrapped via `windowsShimCommand` with per-argument validation.
- Commands classify into effects: `READ_ONLY` `BUILD_OUTPUT` `SOURCE_MUTATION` `REPOSITORY_STATE` `UNKNOWN`. Read-only may run concurrently; mutations and unknowns take conservative workspace locks; build outputs may overlap when output areas don't conflict.
- Risk + typed permission rules (V2) decide: run, ask (approval ticket), or deny. Aevra never auto-elevates and doesn't run as root/SYSTEM.
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

The persisted `power.keepAwake` setting supports `off`, `remote-connections` (default), `managed-processes`, and `always`. Aevra evaluates the selected policy every 5 seconds and uses a platform sleep inhibitor only while needed. Windows reasserts `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` every 30 seconds and fails visibly if the OS call returns an error, macOS uses `caffeinate -i`, and Linux holds both `idle` and `sleep` logind inhibitors. The policy does **not** force the display on or disable screen locking. Unsupported platforms degrade to an explicit unavailable status rather than failing startup.

## Change sets & recovery (short version)

Destructive edits journal intent + snapshots before executing (`change_begin/status/commit/rollback`). After a crash, incomplete operations reconcile into explicit states — `INTERRUPTED`, `EXECUTION_OUTCOME_UNKNOWN`, `RECOVERY_REQUIRED` — and are **never auto-replayed**. Full detail: [`08-audit-recovery`](08-audit-recovery.md).

**Boundaries:** admission/approval mechanics (`02`); recovery internals (`08`).

**Related:** [`02-security-model`](02-security-model.md) · [`../user-manual/07-workspaces`](../user-manual/07-workspaces.md)

**Next →** [`07-state-migration`](07-state-migration.md)
