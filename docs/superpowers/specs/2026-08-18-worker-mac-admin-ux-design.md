# Worker MAC and Admin UX Design

## Goal

Fix command execution failures caused by Core/Worker envelope MAC drift and improve administration UX for permissions, sessions, workspaces, command approvals, the Safe command matchers Guide, scrollbars, and Dashboard sections.

## Constraints

- Work directly on `main` only.
- Preserve HMAC authentication, replay protection, expiry checks, daemon-instance binding, and the authenticated IPC handshake.
- Preserve exact-capability permission semantics. Do not return to profile-wide capability upgrades.
- CRITICAL commands remain one-time approval only.
- Persistent command approvals may use session, workspace, or global scope.
- Reuse the existing `AevraDataTable` rather than introducing a second table implementation.
- No GitHub Actions workflow is added.

## 1. Worker envelope MAC correctness

Core signs an in-memory operation envelope. IPC then serializes it with `JSON.stringify`. JavaScript JSON serialization omits object properties whose value is `undefined` and converts `undefined` array elements to `null`. The existing HMAC canonicalizer signs `undefined` as if it were a real value, so a command envelope containing optional undefined values can be signed differently from the object the Worker receives.

Canonical HMAC input must match JSON transport semantics:

- object keys whose values are `undefined` are omitted;
- array entries that are `undefined` become `null`;
- remaining object keys are recursively canonicalized and sorted;
- all existing HMAC, expiry, nonce and daemon-instance checks remain unchanged.

A regression test must sign an envelope with nested optional undefined values, JSON round-trip it, then verify it successfully. Tampering after the round trip must still fail MAC verification.

## 2. Command approval matchers

Command risk/effect classification remains based on the existing command classifier. Remembered permission matching gets a separate normalized matcher generated from the concrete command.

Matcher rules:

- executable and stable command/subcommand structure remain explicit;
- file paths, file names, positional values, and option values are replaced by `*`;
- option names remain explicit where useful;
- duplicate wildcard runs are collapsed;
- shell execution is deliberately broad and visibly HIGH risk; shell script text is not persisted verbatim;
- the exact matcher that would be persisted is shown in the approval UI.

Examples:

- `git diff src/app.ts` -> `git:diff:*`
- `dotnet test tests/Aevra.Tests.csproj --filter Category=Fast` -> `dotnet:test:*:--filter:*`
- `npm test -- --runInBand` -> `npm:test:--:*`
- `cargo test worker_manager` -> `cargo:test:*`

For a new non-CRITICAL `commands.run` request, Requests exposes:

- Deny
- Run once
- Allow this session
- Always in workspace
- Always globally

Persistent approval rules use the normalized matcher. CRITICAL requests expose only Deny and Run once.

## 3. Permissions table

Replace the custom static Permissions table with `AevraDataTable`.

- Search across capability, actor/connector, target, matcher and timestamps.
- Filters: Effect, Capability, Scope, Connector/actor.
- Sort and pagination via the shared data-table implementation.
- Default page size 25; existing 10/25/50/100 selector remains.
- Revoke action remains available and contextual toast behavior is preserved.

## 4. Workspaces table

Replace the custom Workspaces table with `AevraDataTable`.

- Search Name, Local root and Description.
- Filter External mounts: All / Has mounts / No mounts.
- Pagination and sorting use the shared component.
- Details, Remove, and workspace-detail modal behavior remain unchanged.

## 5. Sessions tables

Use `AevraDataTable` for both session groups.

Remote MCP sessions:

- Search Actor, Session ID and current workspace label.
- Filters: Actor and Workspace state (`Workspace active` / `No workspace`).
- Pagination and sorting.
- Preserve Switch and Revoke actions.

Local admin sessions:

- Search session hash and dates.
- Pagination and sorting.
- Preserve Revoke action.

`Revoke all others` stays in the page toolbar.

## 6. Safe command matchers Guide

Add `Copy all` in the top-right of the Safe command matchers chapter. It copies matcher strings for the currently selected Windows/Linux/macOS tab, one matcher per line. Individual Copy buttons remain.

## 7. Scrollbars

Apply global thin scrollbar styling:

- width/height: 6px;
- transparent track and corner;
- subtle thumb only;
- Firefox uses `scrollbar-width: thin` and transparent track color.

This applies across tables, modals, nav, Guide, drawers, and page scrolling.

## 8. Dashboard collapsible sections

Every top-level Dashboard section is independently collapsible and defaults expanded:

- Remote Access
- Onboarding
- Runtime overview
- Active connections
- Tool activity
- Connections
- Recent activity

Use semantic `<details open>` sections with a consistent clickable summary/header. Completed onboarding must no longer auto-collapse or absorb Remote Access; Remote Access remains its own independent section.

## Verification

Add/adjust targeted tests for:

- envelope MAC JSON round-trip with undefined values and tamper rejection;
- normalized command matcher generation;
- exact persisted matcher for session/workspace/global approvals and CRITICAL once-only behavior;
- Requests UI includes all persistent scopes only for non-CRITICAL commands and shows saved matcher;
- Permissions, Workspaces, and Sessions use `AevraDataTable` with requested filters/search/pagination;
- Safe command matcher Copy all;
- thin transparent scrollbar CSS;
- Dashboard top-level sections are `<details open>` and v3 no longer auto-collapses/reparents onboarding/Remote Access.

Run the focused tests first, then `npm test`, `npm run test:web`, and `npm run build` when a runnable checkout is available.