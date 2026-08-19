# Durable MCP Processes, Typed Tools, Skill Permissions, and Switch Controls

## Status

Approved 2026-08-20.

## Goals

1. Make long-running commands reconnect-safe for ChatGPT, Claude, and other MCP clients without depending on a single long-lived HTTP tool request.
2. Expose durable terminal process state, including exit code, signal, completion time, duration, and final log position.
3. Add exact MCP input/output schemas and structured results for stable public tools, prioritizing process and skill/instruction tools.
4. Add purpose-specific `skills.read`, `skills.write`, `instructions.read`, and `instructions.write` capabilities.
5. Add dedicated `skill_write` and `instructions_write` tools instead of requiring broad workspace file-write access.
6. Replace visible binary checkboxes in the React admin UI with a reusable OpenCode-style switch while preserving native form/accessibility semantics.

## Long-running execution

`command_run` remains synchronous and bounded. Long-running work uses managed processes.

Add:

- `process_status(processId)` for one durable snapshot.
- `process_wait(processId, timeoutMs)` for bounded long-polling. The call must return when the process reaches a terminal state or when the wait window expires. Default and maximum waits must stay well below typical upstream HTTP timeouts.

Extend existing process responses with:

- `state`: `running | completed | failed | stopped | unknown`
- `exitCode`: integer or null
- `signal`: string or null
- `startedAt`
- `finishedAt`: string or null
- `durationMs`: number or null

`process_logs` additionally returns process state, exit code, signal, and `eof` when a terminal process has no unread lines.

`process_list` returns the same status fields for every process.

### Persistence

The canonical `managed_processes` row stores terminal state. Add `state`, `exit_code`, `signal`, `finished_at`, and `failure_message` columns.

For attached worker-managed processes, the worker runtime captures child completion and exposes it through status/list/log calls. Core reconciles the returned status into SQLite whenever it observes a process.

For `keep-running` processes, the detached process host writes an atomic result sidecar adjacent to the log when its child exits. The sidecar records process state, exit code, signal, and finish time. Worker status/log/list calls read the sidecar so completion remains observable after the helper has exited.

A disconnected MCP client can reconnect and query the same process ID while the Aevra process record remains available.

## MCP schemas

Stable tools should avoid `additionalProperties: true` where the public contract is known.

Tool descriptors support both `inputSchema` and `outputSchema`. Tool results continue providing backward-compatible textual/content output through the MCP server while also publishing `structuredContent` for typed clients.

Process tool schemas are explicit. Skill/instruction read/write schemas are explicit. Annotations remain accurate for read-only, destructive, idempotent, and open-world behavior.

Native MCP Tasks may be added later behind capability negotiation; Aevra's process workflow must not depend on experimental client task support.

## Skill and instruction capabilities

Add protocol capabilities:

- `skills.read`
- `skills.write`
- `instructions.read`
- `instructions.write`

Read tools require their corresponding read capability. Write tools require their corresponding write capability and normal Aevra permission/approval evaluation.

`skill_write` writes one file inside an existing workspace or user skill package. It may create/replace `SKILL.md` or another relative file but must reject path escape, absolute paths, directories, and files larger than the existing skill file cap.

`instructions_write` writes either the user instruction file (`~/.agents/AGENTS.md`) or the active workspace `AGENTS.md`. It does not write arbitrary workspace paths.

All writes are bounded UTF-8 text operations and are auditable through the normal tool/approval path.

YOLO sessions include all four capabilities.

## UI switches

Create a shared React `Switch` component implemented with a real `<input type="checkbox">` for forms and keyboard behavior. The visible control is a flat OpenCode/Aevra-style track with a moving thumb.

Requirements:

- 4px radius
- 1px hairline border
- no gradients or shadows
- neutral off state, accent on state
- visible `:focus-visible`
- disabled state
- `role="switch"` and `aria-checked`
- works with `name`, `value`, `defaultChecked`, and `onChange`

Replace all user-visible binary checkbox controls in `apps/web-react` with this shared component. Permission capability cards gain switches for the four new capabilities.

## Compatibility and safety

- Existing process IDs and existing rows remain readable after migration.
- Existing permission rules remain valid.
- Existing file capabilities do not implicitly grant skill/instruction write access.
- User-scope skill/instruction writes remain restricted to `~/.agents` locations owned by Aevra's current user.
- Workspace-scope skill/instruction writes remain restricted to the active workspace's dedicated skill/instruction locations.
- No direct remote creation or modification of workspace roots or external mounts is introduced.
