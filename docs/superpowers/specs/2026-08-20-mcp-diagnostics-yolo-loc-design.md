# MCP Diagnostics, Session YOLO, and LOC Compliance Design

## Goal

Improve Aevra's ability to explain client-side MCP failures, add an explicit session-scoped YOLO mode for connector sessions from the request approval UI, and resolve the current LOC/source-policy violations without changing unrelated behavior.

## MCP diagnostics

The error `FORBIDDEN: This conversation does not support developer MCPs` is produced before Aevra receives an MCP request. Aevra therefore cannot bypass it. Aevra can, however, record the MCP traffic it actually sees and distinguish a healthy local service from a client that stopped sending requests.

Core will maintain an in-memory diagnostic snapshot with listener state, request/initialize/tool-call counts, last inbound timestamp, last MCP method, last authenticated actor/session, and last tool name. The snapshot exposes a derived hint: `no-client-traffic`, `initialized-no-tools`, `active`, or `stopped`.

The local admin surface will expose this snapshot through the existing runtime status plus a dedicated local diagnostics route. The Web UI will show the state without claiming knowledge of a client-side error that never reached Aevra. A `no-client-traffic` state means Aevra is listening but has not received MCP traffic; UI copy can identify client/tool-host restrictions as a likely external cause.

## Session YOLO mode

YOLO is intentionally ephemeral and connector-session scoped.

Enabling YOLO for a connector session causes Aevra to treat the active lease as having every defined Aevra capability and bypass the normal permission/approval decision path for subsequent operations in that session. The persistent lease remains unchanged; the elevation is overlaid in memory so disabling YOLO immediately restores the original lease capabilities.

YOLO does not disable workspace containment, canonical path checks, connector workspace binding, worker isolation, DLP, or other execution safety boundaries outside capability/approval policy. It does not persist across daemon restart, session revocation, or reconnect into a new session.

Only sessions whose actor is a connector actor may enter YOLO mode. Enabling/disabling is local-admin only and is appended to the audit log. The request approval drawer gets a danger action that enables YOLO for that request's session and approves the currently pending request so the caller can resume immediately. Session listing exposes a `yolo` flag, and local admin provides an explicit disable endpoint.

## LOC refactors

The seven flagged files will be split by responsibility rather than compressed further:

- `apps/core/src/auth/oauth.ts`: move OAuth validation/hash helpers to `oauth-helpers.ts`.
- `apps/core/src/mcp/server.ts`: move generic HTTP/OAuth routing helpers to focused MCP modules and keep the server readable; introduce diagnostics as a separate module.
- `apps/core/src/operations/operation-service.ts`: move file-mutation execution and unified-patch application into `file-mutations.ts`.
- `apps/core/src/runtime.ts`: move runtime public types and small runtime helper responsibilities out of the composition root.
- `apps/core/test/admin-control-plane.integration.test.ts`: remove only excess whitespace or split one test if required; do not compress multiple statements onto a line.
- `apps/web-react/src/features/settings/SettingsPage.tsx`: move a small presentational/helper unit out rather than compress JSX.
- `packages/store/src/oauth.ts`: move OAuth record types/row mappers into `oauth-records.ts` and re-export public types from the original module.

All source files must remain below the repository's LOC limits and `server.ts` must also pass the artificial-compression heuristic.

## Testing

Add focused tests for:

- YOLO rejects non-connector sessions, exposes all capabilities dynamically, reverts on disable, and clears on revoke.
- authorization bypass occurs only while YOLO is enabled.
- local admin YOLO action enables the session and resolves the current approval.
- MCP diagnostics derive the correct hint as traffic progresses.

Existing OAuth, MCP compatibility, operation service, runtime, store, React request/settings, LOC lint, typecheck, lint, and repository test suites remain the regression gates.
