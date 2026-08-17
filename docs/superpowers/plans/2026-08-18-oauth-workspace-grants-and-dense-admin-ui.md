# OAuth Workspace Grants and Dense Admin UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve approved read-only workspace access across ChatGPT MCP reconnects for one OAuth authorization, avoid repeated workspace prompts, surface concrete endpoint-test toasts, and make list-heavy admin pages substantially denser and responsive.

**Architecture:** Give every OAuth authorization a unique persistent token subject, then keep ephemeral connection-scoped workspace grants in `SessionManager`. Fresh MCP sessions restore the last active workspace from that grant while still creating new security session/lease IDs. UI work stays in the vanilla browser shell using shared dense-row markup/CSS rather than introducing a framework.

**Tech Stack:** Node.js 22+, TypeScript, node:sqlite, MCP Streamable HTTP, vanilla JavaScript/CSS, node:test.

## Global Constraints

- Continue on `fix/chatgpt-mcp-xai-ui`; do not modify `main`.
- Workspace approval grants `read-only`, not `developer`.
- OAuth connection workspace grants are memory-only and clear on Aevra restart.
- A new OAuth authorization must get a different subject and must approve workspace access again.
- Static connector workspace bindings retain existing behavior.
- Mutation capabilities and approval policies remain unchanged.
- Endpoint test inline feedback remains; toast uses the same concrete result.
- Keep the current navigation/content; list-heavy pages become compact and responsive.
- Do not use personal/local folder examples in placeholders.

---

### Task 1: Give each OAuth authorization a unique connection subject

**Files:**
- Modify: `packages/store/src/oauth.ts`
- Test: `apps/core/test/oauth-service.unit.test.ts`
- Test: `apps/core/test/mcp-oauth.integration.test.ts`

**Interfaces:**
- Produces: OAuth token `subject` that is stable across refresh rotation but unique per authorization.

- [ ] Add a failing OAuth test that performs two authorization-code grants for the same registered client and asserts their verified token subjects differ.
- [ ] Add a failing refresh test asserting a refreshed access token keeps the original authorization subject.
- [ ] Run the targeted OAuth tests and confirm failure under the current `subject=clientId` behavior.
- [ ] Change authorization-code issuance to generate a unique grant subject (for example `oauth_grant_<uuid>`) and persist it through authorization code/access/refresh token records.
- [ ] Run the targeted OAuth tests and confirm both uniqueness and refresh continuity.

### Task 2: Add ephemeral connection workspace grants to SessionManager

**Files:**
- Modify: `apps/core/src/sessions/session-manager.ts`
- Test: `apps/core/test/session-manager.unit.test.ts`

**Interfaces:**
- Produces: `grantConnectionWorkspace(sessionId:string, workspaceId:string, profileId:string): WorkspaceLease`
- Produces: connection-grant lookup used by `admitWorkspace` and reconnect restoration.

- [ ] Add a failing session-manager test: approve/read-grant workspace on session A, disconnect it, create session B with the same OAuth subject, and assert B automatically has a fresh lease for the same workspace.
- [ ] Add a failing test showing a different OAuth subject receives no lease.
- [ ] Add a failing test showing `invalidateForRestart()` clears the connection grant.
- [ ] Implement in-memory subject → workspace/profile grant storage plus subject → last-active-workspace storage.
- [ ] Make `admitWorkspace` honor an existing connection grant when no auto-admission/connector override is available.
- [ ] Make successful workspace admission update the last-active workspace for a connection-granted subject.
- [ ] Make `create()` restore the last active connection-granted workspace with a fresh lease, while keeping the new security session ID.
- [ ] Make `invalidateForRestart()` clear both connection grant maps.
- [ ] Run session-manager tests.

### Task 3: Make workspace approval connection-scoped and read-only

**Files:**
- Modify: `packages/mcp-tools/src/service.ts`
- Test: `apps/core/test/runtime.integration.test.ts` or create `apps/core/test/mcp-workspace-reconnect.integration.test.ts`

**Interfaces:**
- Consumes: `SessionManager.grantConnectionWorkspace(...)` from Task 2.
- Produces: deduplicated workspace-access approval keyed by OAuth subject + workspace.

- [ ] Add an integration regression for: session A `workspace_select` → approval → resume → `file_list` succeeds → session B same OAuth subject → `workspace_current` and `file_list` succeed → no second approval.
- [ ] Add a regression asserting a different OAuth subject requires a new workspace approval.
- [ ] Add a regression asserting another workspace in the same OAuth connection requires its own approval.
- [ ] Add a regression asserting the resulting lease contains read capabilities but not `files.write`/`commands.run`.
- [ ] Change workspace approval payload to include the connection subject and use `profileId='read-only'`.
- [ ] Deduplicate PENDING/APPROVED workspace tickets by actor + connection subject + workspace, not original MCP session ID.
- [ ] Allow approved workspace tickets to resume after MCP reconnect when actor + OAuth subject + workspace match.
- [ ] On frozen workspace approval execution call `grantConnectionWorkspace()` so later reconnects auto-restore the workspace.
- [ ] Run the reconnect regression and existing MCP/runtime tests.

### Task 4: Put concrete endpoint test result in the toast

**Files:**
- Modify: `apps/web/ui-runtime.js`
- Test: `scripts/test/web-admin-shell.test.mjs`

**Interfaces:**
- Produces: endpoint-test toast derived from `/api/cloudflare/test` response body.

- [ ] Add failing web-shell assertions that the runtime has special handling for `/cloudflare/test` response JSON and no longer uses `Remote endpoint checked` as the endpoint-test toast.
- [ ] Implement response-aware mutation toast logic: reachable response → success toast `Endpoint reachable (HTTP <status>)`; unreachable response → error toast with returned message.
- [ ] Preserve app.js inline result rendering.
- [ ] Run browser syntax checks and web-shell tests.

### Task 5: Introduce a dense-list UI primitive

**Files:**
- Modify: `apps/web/app.js`
- Modify: `apps/web/app.css`
- Test: `scripts/test/web-admin-shell.test.mjs`

**Interfaces:**
- Produces: shared dense-list/dense-row markup classes used by list-heavy pages.

- [ ] Add failing web-shell assertions for shared classes such as `dense-list`, `dense-row`, `dense-head`, `dense-actions`, `dense-badge`, `dense-details`, and responsive rules.
- [ ] Add lightweight helper functions in `app.js` for badges, dense list shells, and compact empty states.
- [ ] Add CSS for sticky list headers, 34–40px desktop rows, compact badges/actions, and responsive tablet/mobile stacking.
- [ ] Run web-shell tests and JavaScript syntax validation.

### Task 6: Convert Approvals to pending + compact history

**Files:**
- Modify: `apps/web/app.js`
- Modify: `apps/web/app.css`
- Test: `scripts/test/web-admin-shell.test.mjs`

**Interfaces:**
- Consumes: dense-list primitive from Task 5.

- [ ] Add failing assertions that approvals render pending and history lists and that workspace-access pending rows expose only Allow/Deny.
- [ ] Render pending approvals first with columns Type, Actor, Workspace, Risk, Status, Actions.
- [ ] Render completed/denied/expired approvals as compact history rows with local time and no large cards.
- [ ] Keep OAuth pairing approvals separate and compact.
- [ ] Run web-shell tests.

### Task 7: Compact remaining list-heavy tabs

**Files:**
- Modify: `apps/web/app.js`
- Modify: `apps/web/app.css`
- Test: `scripts/test/web-admin-shell.test.mjs`

**Interfaces:**
- Consumes: dense-list primitive from Task 5.

- [ ] Workspaces: collapse Add workspace; show compact workspace summary rows; move mounts/admission forms into expandable row details.
- [ ] Permissions: collapse Create permission rule and render compact rows.
- [ ] Sessions: render compact remote/admin session rows; move workspace switch form into details.
- [ ] Connectors: collapse token creation and render compact rows.
- [ ] Processes: render compact rows and move detached warning into details.
- [ ] Changes: render compact rows; move rename into details.
- [ ] Audit: render a sticky-header filterable dense list with local time, operation, actor, target.
- [ ] Add/adjust web-shell assertions for compact list coverage on every page.
- [ ] Run web-shell tests and browser syntax checks.

### Task 8: Verification

**Files:**
- Verify only.

- [ ] Run `npm run format:check`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run typecheck`.
- [ ] Run targeted OAuth/session/MCP regression tests.
- [ ] Run `npm run test:web`.
- [ ] Run `npm run test:unit`.
- [ ] Run `npm run test:integration`.
- [ ] Run `npm run build`.
- [ ] Read the automatically-triggered GitHub Actions status only; do not manually rerun or cancel CI.
