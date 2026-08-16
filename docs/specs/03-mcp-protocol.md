# 03 — MCP Protocol

**Audience:** engineers & AI agents · **Scope:** transport, session lifecycle, tools, errors · **Verified against:** `0.1.0`

## Transport

Streamable HTTP JSON-RPC 2.0 over TLS at `https://localhost:47830/mcp` (or `/mcp/<connector-token>`), protocol version `2025-06-18`. Requests: `POST` (JSON-RPC body), `DELETE` (session disconnect). `GET /health` is unauthenticated `{ok:true}`. Max request body: 1 MB.

Aevra does not keep a tool HTTP request open for the lifetime of a long-running command. Long work returns a managed process ID and is observed through bounded follow-up tool calls, so an MCP client may reconnect at the transport level without depending on one multi-minute response.

## Session lifecycle

1. `initialize` → server creates a session, returns header `mcp-session-id: ses_<uuid>` and `serverInfo {name:"Aevra", version:"0.1.0"}`.
2. Every subsequent `POST` carries that header; `DELETE` disconnects. The session's admission identity (actor + subject) must match on every call — sessions cannot be hijacked across identities.
3. Reconnects always create **fresh** sessions; clients re-select their workspace. Managed process records belong to the workspace, not to one outstanding HTTP request.

## Tool vocabulary (40 tools)

| Group     | Tools                                                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| Status    | `aevra_status`                                                                                                   |
| Workspace | `workspace_list` `workspace_select` `workspace_current`                                                          |
| Files     | `file_list` `file_read` `file_search` `search` `file_create` `file_write` `file_patch` `file_move` `file_delete` |
| Command   | `command_run` `shell_run`                                                                                        |
| Git       | `git_status` `git_diff` `git_log` `git_branch` `git_commit` `git_push`                                           |
| Processes | `process_start` `process_list` `process_status` `process_wait` `process_logs` `process_stop` `process_restart`   |
| Changes   | `change_begin` `change_status` `change_commit` `change_rollback`                                                 |
| Approvals | `approval_status` `approval_wait` `approval_cancel`                                                              |
| Skills    | `skills_list` `skill_read` `skill_write` `instructions_read` `instructions_write`                                |

Stable public tools advertise closed `inputSchema` definitions and an `outputSchema`. Results retain text compatibility as `{content:[{type:'text'}]}` and also expose `structuredContent`; array results are represented as `{result:[...]}` in structured content. Tool errors arrive inside a normal result as `{error:{code,message,details}}` with `isError:true`.

### Long-running command pattern

Use `command_run` only when completion is expected inside the bounded synchronous command window. For longer work:

1. `process_start` → returns `processId` immediately.
2. `process_wait {processId, timeoutMs?}` → waits at most 30 seconds, returning early on completion.
3. `process_logs {processId, cursor?}` → returns incremental logs plus terminal metadata.
4. `process_status {processId}` → returns the durable status snapshot at any time.
5. Terminal states expose `exitCode`, `signal`, `finishedAt`, and `durationMs`, allowing an AI client to prove whether tests/builds actually succeeded.

`process_wait` returning `state:"running"` is not a timeout error; the client may call it again. Native MCP Tasks can be added later behind negotiated client support, but Aevra's compatibility workflow does not depend on experimental task support.

## Error codes

`CAPABILITY_REQUIRED` · `SESSION_WORKSPACE_REQUIRED` · `WORKSPACE_ESCAPE` · `WRITE_CONFLICT` · `MERGE_CONFLICT` · `APPROVAL_PENDING` · `APPROVAL_DENIED` · `APPROVAL_TIMEOUT` · `APPROVAL_CONTEXT_CHANGED` · `EXECUTOR_UNAVAILABLE` · `RECOVERY_REQUIRED` · `EXECUTION_OUTCOME_UNKNOWN` · `INVALID_REQUEST` · `UNAUTHORIZED` · `NOT_FOUND` · `VAULT_LOCKED` · `SKILL_NOT_FOUND` · `SKILL_PATH_ESCAPE` · `SKILL_FILE_TOO_LARGE`

HTTP-level: `401` admission failure · `405` bad method · `503` safe mode · `501` tools not wired.

**Boundaries:** admission mechanics (`02`, `04`); what each tool _does_ (`06`, manual).

**Related:** [`04-connectors`](04-connectors.md) · [`05-skills-instructions`](05-skills-instructions.md)

**Next →** [`04-connectors`](04-connectors.md)
