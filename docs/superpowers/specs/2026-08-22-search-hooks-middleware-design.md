# Parallel Search and Privileged Hooks Middleware Design

## Goal

Extend Aevra with a fast native multi-query `search` MCP tool and a configurable privileged hook middleware system, while hardening the in-progress MCP `2026-07-28` migration found during review.

## Scope

This design has three independently testable implementation streams that share the same security model and branch:

1. MCP 2026 migration hardening.
2. Native parallel `search` tool.
3. Privileged hook middleware with full payload transformation.

All changes remain on `feat/mcp-2.0-migration` and preserve the current legacy MCP revisions.

## MCP migration review fixes

Before feature completion Aevra will:

- move modern identity-session reuse into `SessionManager.getOrCreateForIdentity(identity, remoteIp?)` instead of scanning `sessions.list()` from MCP ingress;
- preserve arbitrary JSON values in MCP 2026 `structuredContent` instead of wrapping arrays or primitives in `{ result: value }`;
- strengthen modern request header validation, including Base64-sentinel `Mcp-Name` handling and declared `Mcp-Param-*` values where applicable;
- return unsupported-version error `-32022` for unsupported modern `server/discover` protocol revisions;
- restore `RemoteIdentityVerifier` typing in `McpIngressServer`;
- sort modern tool lists with locale-independent ordinal comparison;
- add focused coverage for these cases without reducing the repository coverage threshold.

## Native parallel `search`

### Public tool

A new stable MCP tool is named exactly `search`. It is separate from `file_search`; the existing tool remains compatible.

The tool requires the existing `files.search` capability and is annotated read-only and idempotent.

Input contains `queries`, an array of query objects. Each query supports:

- `query`: required string;
- `path`: optional logical workspace path, default `/`;
- `mode`: `text`, `regex`, or `files`, default `text`;
- `glob`: optional include glob;
- `exclude`: optional exclude glob list;
- `caseSensitive`: optional boolean, default false;
- `maxResults`: optional positive integer capped by server settings;
- `contextLines`: optional non-negative integer capped by the implementation.

A call may also target a registered workspace using Aevra's existing `workspace` or `workspaceId` fields.

### Limits

`execution.settings.searchMaxParallelQueries` controls how many query objects an AI may submit in one call.

- default: `8`;
- minimum: `1`;
- maximum configurable value: `32`;
- clients cannot override the server upper bound.

`execution.settings.searchMaxResultsPerQuery` defaults to `100` and is bounded to prevent oversized responses. The implementation also applies a total output byte cap independent of query count.

### Execution architecture

Search executes inside the existing signed Execution Worker envelope. The protocol adds a `search.parallel` worker operation carrying normalized query definitions and limits.

The worker resolves every query path through capability-root containment before launching a native search process.

Backend selection is deterministic:

1. use `rg` when available;
2. on Windows, fall back to PowerShell/native filesystem search;
3. on Unix-like systems, fall back to `grep`/`find`.

Commands are spawned with executable and argument arrays; Aevra never constructs shell command strings from user input.

Queries run concurrently through a bounded pool whose concurrency is at most `searchMaxParallelQueries`. A failed query produces an error for that result group without discarding successful sibling queries.

### Search security

The search path is resolved before process execution. Returned host paths are mapped back to logical workspace paths. Matches are then classified using Aevra sensitivity rules:

- `SECRET` resources are omitted;
- `SENSITIVE` lines are masked;
- normal lines are returned;
- output remains subject to normal Aevra output/DLP handling.

Native backend unavailability may trigger the documented fallback. Invalid patterns, denied paths, timeouts, and query-specific errors do not silently fall back to unrestricted shell execution.

### Result contract

Results are grouped in input order. Each group contains the original normalized query, selected backend, matches, optional structured error, and `truncated` state. The top-level summary contains query count, match count, duration, and whether total output was truncated.

## Privileged hooks middleware

### Hook ownership

Hooks are persistent local-admin configuration. Remote MCP clients do not receive hook create/update/delete tools. This prevents an AI from installing persistent executables on the host.

Hooks are stored through the existing settings persistence under `hooks.config`. Search limits remain under `execution.settings`.

### Hook events

Initial supported events are:

- `gateway_started`
- `gateway_stopping`
- `connector_connected`
- `connector_disconnected`
- `session_start`
- `session_reconnect`
- `session_end`
- `workspace_selected`
- `workspace_changed`
- `request_received`
- `prompt_received`
- `prompt_transformed`
- `before_tool_call`
- `tool_call_blocked`
- `after_tool_call`
- `tool_call_failed`
- `approval_requested`
- `approval_granted`
- `approval_denied`
- `permission_denied`
- `process_started`
- `process_finished`
- `process_failed`
- `before_response`
- `response_finished`
- `response_failed`

`prompt_received` is best-effort because standard MCP transport does not normally expose the natural-language user prompt. It fires only when a client supplies prompt information. `request_received` is the guaranteed transport-level event for each MCP request.

### Hook definitions

Each hook has:

- stable `id` and display `name`;
- `enabled` state;
- one or more events;
- numeric `priority`;
- kind `command` or `application`;
- executable and argument array;
- optional working directory;
- input mode `stdin`, `temp-file`, or `none`;
- permissions from `observe`, `block`, `modifyPrompt`, `modifyToolInput`, `modifyToolOutput`, `modifyResponse`;
- failure mode `open` or `closed`;
- timeout;
- global or workspace scope;
- optional tool and connector filters;
- environment values and secret references.

Hooks with any `modify*` capability are privileged and must be visibly marked as such in the UI.

### Hook execution protocol

Command hooks receive a versioned JSON envelope containing invocation ID, hook ID, event, timestamp, session/connector/workspace/protocol context, and event payload. `stdin` mode sends JSON to stdin; `temp-file` mode writes a bounded temporary JSON file and passes its path as a dedicated argument; `none` sends no payload.

A command hook returns exactly one JSON result with action `continue`, `modify`, or `block`. `modify` includes a replacement payload. `block` includes an optional reason.

Application hooks are fire-and-forget observers. They cannot hold `modify*` permissions because they do not return a transformation response.

### Mutation permissions

Mutation is event-specific:

- `prompt_received` may modify prompt data;
- `prompt_transformed` is observe-only;
- `request_received` may modify only explicitly protocol-safe metadata, never authenticated identity or authorization state;
- `before_tool_call` may modify tool name and arguments;
- `after_tool_call` may modify tool output;
- `before_response` may modify the outgoing response;
- `response_finished` is observe-only because the response has already been sent;
- lifecycle/security events are observer/blocker events where blocking has defined meaning.

Returning a mutation without the corresponding configured permission is `HOOK_PERMISSION_VIOLATION`; the mutation is never applied even for fail-open hooks.

### Authorization ordering

Transformed tool input is always revalidated and authorized as the effective request:

`incoming call -> before_tool_call hooks -> schema/path validation -> capability policy -> approval -> execute effective tool`.

Therefore a hook changing `file_read` into `shell_run` requires the full permissions and approval required by `shell_run`. A hook cannot mutate an operation after authorization.

For output:

`raw result -> after_tool_call hooks -> DLP -> before_response hooks -> DLP -> send -> response_finished`.

The second DLP pass is required because `before_response` may introduce sensitive material.

### Ordering and recursion

Matching hooks run sequentially by ascending `priority`, then stable hook ID. Each accepted transformation becomes the payload passed to the next hook.

The engine enforces per-hook timeout, overall chain timeout, stdout/stderr caps, payload cap, transformation-count cap, and recursion depth. Hook child processes carry an internal execution marker so they cannot recursively trigger the same hook chain.

### Failure modes

Hook errors use structured codes:

- `HOOK_TIMEOUT`
- `HOOK_EXIT_FAILED`
- `HOOK_INVALID_OUTPUT`
- `HOOK_PERMISSION_VIOLATION`
- `HOOK_BLOCKED`
- `HOOK_CHAIN_LIMIT`
- `HOOK_PAYLOAD_TOO_LARGE`

Fail-open records the failure and continues with the unchanged current payload. Fail-closed records the failure and stops the affected operation with a structured Aevra error. Unauthorized mutations are never applied.

### Audit and activity

Every hook invocation records hook ID, event, timing, action, exit status/failure, original payload hash, final payload hash, and a redacted transformation summary. Tool activity additionally records requested tool/argument hash and effective tool/argument hash.

Raw secrets are not persisted in audit data. Hook execution failures and transformations are visible in Live MCP activity.

## Admin API

Hooks expose local-admin endpoints:

- `GET /api/hooks`
- `POST /api/hooks`
- `PATCH /api/hooks/:id`
- `DELETE /api/hooks/:id`
- `POST /api/hooks/:id/test`
- `GET /api/hooks/:id/runs`

The test endpoint uses a synthetic payload and returns bounded/redacted stdout, stderr, exit status, duration, parsed action, and validation errors.

## Settings UI

The Settings page adds a compact Search section for parallel-query and per-query-result limits.

It also adds a Hooks section with a data table showing name, events, kind, scope, permissions, state, and actions. Supported actions are add, edit, enable/disable, duplicate, test, view runs, and delete. Mutation-capable hooks show a `Privileged` badge.

## Verification

The implementation is complete when:

1. MCP migration review fixes have focused tests and preserve legacy behavior;
2. `search` is listed and callable over modern MCP, enforces settings, contains paths, masks sensitive output, and works on Windows and Unix fallbacks;
3. hook ordering, mutations, blocking, failure modes, recursion protection, lifecycle events, audit integration, local admin API, and Settings UI are covered;
4. transformed tool calls are authorized using final tool/arguments;
5. transformed outputs receive DLP after mutation;
6. existing coverage thresholds are retained;
7. formatting, lint, typecheck, tests, coverage, and build pass on Linux and Windows;
8. temporary diagnostic CI files are removed before the PR is marked ready.
