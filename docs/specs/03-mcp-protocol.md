# 03 — MCP Protocol

**Audience:** engineers & AI agents · **Scope:** transport, session lifecycle, tools, errors · **Verified against:** `1.1.0`

## Transport

Streamable HTTP JSON-RPC 2.0 over TLS at `https://localhost:47830/mcp` (or `/mcp/<connector-token>`, or over loopback HTTP if `localProtocol: http` is configured), protocol version `2025-06-18`. Requests: `POST` (JSON-RPC body), `DELETE` (session disconnect). `GET /health` is unauthenticated `{ok:true}`. Max request body: 1 MB.

Aevra does not keep a tool HTTP request open for the lifetime of a long-running command. Long work returns a managed process ID and is observed through bounded follow-up tool calls, so an MCP client may reconnect at the transport level without depending on one multi-minute response.

## Session lifecycle

1. `initialize` -> server creates a fresh session, returns header `mcp-session-id: ses_<uuid>` and `serverInfo {name:"Aevra", version:"1.1.0"}`.
2. Every subsequent `POST` carries that header; `DELETE` disconnects. The session's admission identity (actor + subject + durable OAuth connection when present) must match on every call.
3. OAuth reconnects create a fresh MCP session. Remembered connection-scoped workspace grants are restored automatically; session-only workspace leases are restored only while their original expiry is still valid.
4. A normal reconnect never auto-replays a mutating request whose response was lost. `operation_get` and `operation_list` let the same OAuth connection inspect durable operation outcomes before deciding what to do next. Managed process records likewise outlive one HTTP request.

## Tool vocabulary (65 discoverable tools)

| Group      | Tools                                                                                                                                                                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status     | `aevra_status` (reports session, leases, capabilities, and `execution.system` host capability snapshot)                                                                                                                                                                      |
| Workspace  | `workspace_list` `workspace_select` `workspace_current`                                                                                                                                                                                                                      |
| Files      | `file_list` `file_read_many` `file_search` `search` `file_write_many` `file_move` `file_delete`                                                                                                                                                                              |
| Command    | `command_run_many` `shell_run`                                                                                                                                                                                                                                               |
| Git        | `git_status` `git_add` `git_diff` `git_log` `git_branch` `git_commit` `git_push`                                                                                                                                                                                             |
| Processes  | `process_start` `process_list` `process_status` `process_wait` `process_logs` `process_stop` `process_restart`                                                                                                                                                               |
| Operations | `operation_get` `operation_list`                                                                                                                                                                                                                                             |
| Changes    | `change_begin` `change_status` `change_commit` `change_rollback`                                                                                                                                                                                                             |
| Approvals  | `approval_status` `approval_wait` `approval_cancel`                                                                                                                                                                                                                          |
| Skills     | `skills_list` `skill_read` `skill_write` `instructions_read` `instructions_write`                                                                                                                                                                                            |
| Browser    | `browser_connect` `browser_status` `browser_disconnect` `browser_tabs` `browser_navigate` `browser_snapshot` `browser_read` `browser_act_many` `browser_logs`                                                                                                                |
| Desktop    | `desktop_connect` `desktop_status` `desktop_disconnect` `desktop_windows` `desktop_describe` `desktop_capture` `desktop_click` `desktop_type` `desktop_key` `desktop_scroll` `desktop_invoke` `desktop_set_value` `desktop_select` `desktop_toggle` `desktop_release_window` |

The public MCP discovery surface exposes batch tools as the normal interface for file reads, file mutations, and bounded commands, including single-item operations:

- `file_read_many` accepts one to 32 reads, preserves input ordering, uses bounded concurrency, and returns a result for each requested path.
- `file_write_many` accepts one to 32 creates, replacements, or patches. Its item schema is discriminated by operation, duplicate target paths are rejected before dispatch, and each mutation still uses the ordinary approval, recovery, conflict, and workspace-lock path.
- `command_run_many` accepts one to 16 commands and uses bounded scheduling while serializing commands whose effects may conflict.

The singular primitives `file_read`, `file_create`, `file_write`, `file_patch`, and `command_run` remain internal service operations used by batch delegation and backward-compatible direct calls. They are intentionally omitted from `tools/list` and are not part of model-facing tool selection.

Stable public tools advertise closed `inputSchema` definitions and an `outputSchema`. Results retain text compatibility as `{content:[{type:'text'}]}` and also expose `structuredContent`; array results are represented as `{result:[...]}` in structured content. Tool errors arrive inside a normal result as `{error:{code,message,details}}` with `isError:true`.

### Long-running command pattern

Use `command_run_many` for one or more commands only when each command is expected to complete inside the bounded synchronous command window. For longer work:

1. `process_start` → returns `processId` immediately.
2. `process_wait {processId, timeoutMs?}` → waits at most 30 seconds, returning early on completion.
3. `process_logs {processId, cursor?}` → returns incremental logs plus terminal metadata.
4. `process_status {processId}` → returns the durable status snapshot at any time.
5. Terminal states expose `exitCode`, `signal`, `finishedAt`, and `durationMs`, allowing an AI client to prove whether tests/builds actually succeeded.

`process_wait` returning `state:"running"` is not a timeout error; the client may call it again. Native MCP Tasks can be added later behind negotiated client support, but Aevra's compatibility workflow does not depend on experimental task support.

### Browser pattern

`browser_connect {transport:'extension'|'cdp', cdpPort?}` attaches one session
per Worker; `browser_status` answers even when nothing is attached, which is when
a caller most needs to ask. `browser_snapshot` returns an accessibility tree of
`ref_<version>_<index>` handles, or, in `mode:'vision'`, a screenshot plus
labelled boxes and the `devicePixelRatio` those boxes and any `{x, y}` action
coordinates are expressed in. Each snapshot takes the next version, so a ref from
an older one is refused as `BROWSER_REF_STALE` rather than silently rebound to a
different element. `browser_act_many` runs an ordered batch, and page operations
are serialized per session so two batches cannot interleave on one tab.

### Desktop pattern

`desktop_connect` starts a local helper process and returns four independent
capability booleans — `capture`, `tree`, `attribution`, `input` — so a model
learns once what the host can do instead of discovering it through failures;
`desktop_status` answers even when nothing is connected. Perception is
tree-first: `desktop_describe` returns one window's accessibility tree as
`ref_<generation>_<index>` handles and `desktop_capture` returns pixels only
when asked. A ref from an earlier describe, or from before a helper restart,
is refused as `DESKTOP_REF_STALE` rather than rebound to whatever now sits at
that index.

Desktop automation supports both foreground simulation and background semantic patterns:

1. **Foreground input:** `desktop_click`, `desktop_type`, `desktop_key`, and `desktop_scroll` simulate direct user events on the currently focused window, returning delta indicators (`focusChanged`, `newWindow`, `subtreeChanged`). If the active focus unexpectedly shifts between perception and actuation, the operation fails with `DESKTOP_FOCUS_CHANGED`.
2. **Background semantic automation:** `desktop_describe(mode: 'background')` takes a snapshot of an unfocused background window. Semantic mutation tools (`desktop_invoke`, `desktop_set_value`, `desktop_select`, `desktop_toggle`) invoke native UIA control patterns directly without stealing focus or moving the pointer.
3. **Background window leases:** Mutating background tools require an exclusive 60-second window lease per session/workspace. If another session holds the window, it returns `DESKTOP_WINDOW_BUSY`; if the lease lapses, it returns `DESKTOP_LEASE_EXPIRED`. The lease can be explicitly released using `desktop_release_window`.
4. **Target verification:** Background actions verify the target element's runtime ID, control type, and owning window handle before mutating. Mismatches return `DESKTOP_TARGET_CHANGED`; unsupported UI Automation patterns return `DESKTOP_PATTERN_UNSUPPORTED`.

Reads, foreground input, and background operations fail differently:

- Capture and describe are read-only.
- Foreground input is evaluated against the focused window's process identity by `evaluateWindowGate`; an unattributable window is refused unless `unattributedInput: 'allow'` is configured. Input into a higher-integrity window is blocked by OS UIPI (`DESKTOP_INPUT_REFUSED`).
- Background operations strictly refuse unattributable windows regardless of `unattributedInput` setting.
- Typed or set values are masked in audit logs and approval previews; screenshots are audited by content hash, never stored as raw images.

Desktop error codes: `DESKTOP_NOT_CONNECTED` · `DESKTOP_HELPER` ·
`DESKTOP_HELPER_NOT_INSTALLED` · `DESKTOP_DRIVER_DIED` · `DESKTOP_REF_STALE` ·
`DESKTOP_INPUT_REFUSED` · `DESKTOP_TIMEOUT` · `DESKTOP_WINDOW_BUSY` ·
`DESKTOP_LEASE_EXPIRED` · `DESKTOP_FOCUS_CHANGED` · `DESKTOP_PATTERN_UNSUPPORTED` ·
`DESKTOP_TARGET_CHANGED`

Windows only today: the helper exists for no other platform, so
`desktop_connect` elsewhere reports `DESKTOP_HELPER_NOT_INSTALLED`.
Browser error codes: `BROWSER_NOT_CONNECTED` · `BROWSER_UNAVAILABLE` ·
`BROWSER_REF_STALE` · `BROWSER_CREDENTIAL_FIELD_REFUSED` ·
`BROWSER_ORIGIN_BLOCKED` · `BROWSER_TIMEOUT`

### MCP upstream pattern

Operators register HTTP, SSE, or stdio downstream MCP servers through the Admin
UI or `aevra mcp`. Credentials are referenced by secret id and are resolved
only in the Worker connection path; they never appear in catalogs, status, or
tool results. Each server is catalogued before it is stored, and its tools,
prompts, and resources are republished under a validated namespace such as
`github__tool`, `github__prompt`, or `mcp+github://`.

The configured upstream risk tier applies to every projected tool. Downstream
`readOnlyHint` and `destructiveHint` values are advisory and cannot lower that
tier. Temporary outages remain visible as degraded. A changed catalog enters
Needs review and stops serving until the operator acknowledges the diff. A
disconnect just before a call fails rather than replaying it; reconnect must
validate the catalog first. These dynamic upstream entries are additional to
the 60 built-in tools listed above.

## Error codes

`CAPABILITY_REQUIRED` · `SESSION_WORKSPACE_REQUIRED` · `WORKSPACE_ESCAPE` · `WRITE_CONFLICT` · `MERGE_CONFLICT` · `APPROVAL_PENDING` · `APPROVAL_DENIED` · `APPROVAL_TIMEOUT` · `APPROVAL_CONTEXT_CHANGED` · `EXECUTOR_UNAVAILABLE` · `RECOVERY_REQUIRED` · `EXECUTION_OUTCOME_UNKNOWN` · `INVALID_REQUEST` · `UNAUTHORIZED` · `NOT_FOUND` · `VAULT_LOCKED` · `SKILL_NOT_FOUND` · `SKILL_PATH_ESCAPE` · `SKILL_FILE_TOO_LARGE`

HTTP-level: `401` admission failure · `405` bad method · `503` safe mode · `501` tools not wired.

**Boundaries:** admission mechanics (`02`, `04`); what each tool _does_ (`06`, manual).

**Related:** [`04-connectors`](04-connectors.md) · [`05-skills-instructions`](05-skills-instructions.md) · [`06-workspaces-execution`](06-workspaces-execution.md)

**Next →** [`04-connectors`](04-connectors.md)
