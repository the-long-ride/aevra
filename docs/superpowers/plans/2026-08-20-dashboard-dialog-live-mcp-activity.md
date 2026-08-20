# Common Dialogs and Live MCP Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace browser-native dialogs, widen admin layouts, and add a sanitized real-time MCP activity feed to Dashboard.

**Architecture:** A shared React `DialogProvider` owns all modal message/confirm/choice/prompt interactions. Core gains a bounded in-memory `McpActivityLog`; `McpIngressServer` records operation lifecycle metadata into it, the authenticated admin API exposes it through SSE, and Dashboard consumes the stream with `EventSource` and merges updates by operation id.

**Tech Stack:** TypeScript, React, Vitest/Testing Library, Node `node:test`, Node HTTP SSE, existing Aevra admin contracts/CSS.

**Spec:** `docs/superpowers/specs/2026-08-20-dashboard-dialog-live-mcp-activity-design.md`

## Global Constraints

- Work only on `feat/mcp-long-running-processes-permissions-switches`, never `main`.
- Do not persist live MCP activity; keep it bounded and in-memory.
- Never stream MCP arguments, prompt text, file contents, command text, tool output, tokens, secrets, or environment values.
- Existing local-admin authentication protects the SSE route.
- Text buttons remain content-driven but must have width at least equal to height; compact pagination buttons are exact squares.
- Preserve responsive full-width behavior below desktop breakpoints.

---

### Task 1: Shared dialog system and native-dialog migration

**Files:**
- Create: `apps/web-react/src/components/Dialog.tsx`
- Create: `apps/web-react/src/components/Dialog.test.tsx`
- Modify: `apps/web-react/src/app/App.tsx`
- Modify: `apps/web-react/src/features/dashboard/DashboardPage.tsx`
- Modify: `apps/web-react/src/features/workspaces/WorkspacesPage.tsx`
- Modify: `apps/web-react/src/features/sessions/SessionsPage.tsx`
- Modify: `apps/web-react/src/features/changes/ChangesPage.tsx`
- Modify: `apps/web-react/src/features/audit/AuditPage.tsx`
- Modify: `apps/web-react/src/styles/components.css`

**Interfaces:**
- Produces: `DialogProvider`, `useDialog()` with `message`, `confirm`, `choose`, and `prompt` async methods.
- Produces: a common modal supporting one, two, or three actions and optional text input.

- [ ] **Step 1: Write failing dialog tests**

Test that the provider can render and resolve a message dialog, return `true/false` from confirmation, return the selected id from three-button choice, and return entered text from prompt.

- [ ] **Step 2: Run the web component tests and verify they fail**

Run: `npm test -- --run apps/web-react/src/components/Dialog.test.tsx`

Expected: FAIL because `DialogProvider` / `useDialog` do not exist.

- [ ] **Step 3: Implement the minimal dialog provider/component**

Use the existing `.modal-backdrop`, `.modal`, `.modal-head`, `.modal-body`, and `.modal-foot` patterns. Add common-dialog-specific sizing/action styles, Escape-to-cancel, labelled dialog semantics, and prompt input state.

- [ ] **Step 4: Migrate current native calls**

Replace current `window.confirm` and `window.prompt` usage in Dashboard, Workspaces, Sessions, Changes, and Audit with `useDialog()`. Keep existing API mutations and refresh behavior unchanged.

- [ ] **Step 5: Run dialog/page tests**

Run: `npm test -- --run apps/web-react/src/components/Dialog.test.tsx apps/web-react/src/features/dashboard/dashboard.test.tsx apps/web-react/src/features/management-pages.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat(web): add shared admin dialogs`

---

### Task 2: Per-tab widths, Guide sidebar, and square compact buttons

**Files:**
- Modify: `apps/web-react/src/components/AppShell.tsx`
- Modify: `apps/web-react/src/app/App.test.tsx`
- Modify: `apps/web-react/src/styles/shell.css`
- Modify: `apps/web-react/src/styles/admin.css`
- Modify: `apps/web-react/src/styles/components.css`
- Modify: `apps/web-react/src/styles/tokens.css`

**Interfaces:**
- Produces: `#page[data-page="<AdminPageId>"]` as the stable CSS hook for per-tab sizing.

- [ ] **Step 1: Write the failing shell test**

Assert that the active `#page` carries `data-page="dashboard"`, then changes to `data-page="guide"` after navigation.

- [ ] **Step 2: Run the shell test and verify it fails**

Run: `npm test -- --run apps/web-react/src/app/App.test.tsx`

Expected: FAIL because `#page` does not expose the active page id.

- [ ] **Step 3: Add page sizing hooks and CSS**

Add `data-page={page}` to `#page`; replace the single 1180px desktop cap with the spec's per-tab caps. Keep `width: 100%` at the existing tablet breakpoint.

- [ ] **Step 4: Adjust Guide and buttons**

Change the Guide desktop sidebar from `220px` to `260px`. Give global buttons `min-width: 40px`; make `.dt-pages button` exactly `32px × 32px` with centered content and zero horizontal padding.

- [ ] **Step 5: Run shell and table tests**

Run: `npm test -- --run apps/web-react/src/app/App.test.tsx apps/web-react/src/components/DataTable.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat(web): widen admin layouts and square pager controls`

---

### Task 3: Bounded MCP activity lifecycle log

**Files:**
- Create: `apps/core/src/mcp/activity-log.ts`
- Create: `apps/core/test/mcp-activity-log.unit.test.ts`
- Modify: `apps/core/src/mcp/server.ts`
- Modify: `apps/core/src/runtime.ts`
- Modify: `packages/admin-contracts/src/api-types.ts`

**Interfaces:**
- Produces: `McpActivityEntry` with `id`, `startedAt`, `updatedAt`, `actor`, `sessionId`, optional `workspaceId`, `kind`, `action`, `state`, optional `durationMs`.
- Produces: `McpActivityLog.begin()`, `finish()`, `instant()`, `recent()`, and `subscribe()`.
- Consumes: `SessionManager.activeLease(sessionId)` to attach only workspace id metadata.

- [ ] **Step 1: Write failing core tests**

Test that `begin()` emits `running`, `finish()` updates the same operation id to `success/error`, subscribers receive both states, and retention drops the oldest entry when the configured limit is exceeded.

- [ ] **Step 2: Run the core unit test and verify it fails**

Run: `npm test -- --run apps/core/test/mcp-activity-log.unit.test.ts`

Expected: FAIL because `McpActivityLog` does not exist.

- [ ] **Step 3: Implement `McpActivityLog`**

Use an in-memory array plus subscriber set. Generate operation ids with `randomUUID()`. Never accept/store arbitrary MCP arguments or results in the entry type.

- [ ] **Step 4: Wire MCP lifecycle recording**

Create one activity log in `createCoreRuntime`, pass it to `McpIngressServer`, record `initialize`/disconnect as session activity, and wrap normal JSON-RPC/tool execution with begin/finish. Detect failures from JSON-RPC `error` or `result.isError`. Refresh workspace id on finish.

- [ ] **Step 5: Run core tests**

Run: `npm test -- --run apps/core/test/mcp-activity-log.unit.test.ts apps/core/test/mcp-diagnostics.unit.test.ts apps/core/test/mcp-chatgpt-compat.integration.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat(core): track sanitized MCP activity lifecycle`

---

### Task 4: Authenticated SSE admin activity stream

**Files:**
- Create: `apps/core/src/admin/routes/activity-routes.ts`
- Create: `apps/core/test/admin-activity-routes.unit.test.ts`
- Modify: `apps/core/src/admin/routes/api.ts`
- Modify: `apps/core/src/admin/routes/types.ts`
- Modify: `apps/core/src/runtime.ts`

**Interfaces:**
- Consumes: `AdminApiContext.activity: McpActivityLog`.
- Produces: authenticated `GET /api/activity/stream` SSE endpoint with `activity` events.

- [ ] **Step 1: Write failing route tests**

Assert SSE headers, initial recent-entry emission, live subscriber emission, and listener cleanup on request close.

- [ ] **Step 2: Run the route test and verify it fails**

Run: `npm test -- --run apps/core/test/admin-activity-routes.unit.test.ts`

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement the SSE route**

Set `text/event-stream`, `no-store`, keep-alive headers, send recent entries oldest-to-newest, subscribe to live updates, emit a periodic comment heartbeat, and clean up subscription/timer on close.

- [ ] **Step 4: Register route/context**

Add the activity route to the admin route handler list and pass the shared log through `AdminApiContext` from runtime. Do not bypass `AdminServer`'s existing `/api/*` admin-session gate.

- [ ] **Step 5: Run route/admin tests**

Run: `npm test -- --run apps/core/test/admin-activity-routes.unit.test.ts apps/core/test/admin-auth.integration.test.ts apps/core/test/admin-route-dispatch.integration.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat(admin): stream live MCP activity over SSE`

---

### Task 5: Dashboard live MCP activity panel

**Files:**
- Create: `apps/web-react/src/features/dashboard/McpActivityPanel.tsx`
- Create: `apps/web-react/src/features/dashboard/McpActivityPanel.test.tsx`
- Modify: `apps/web-react/src/features/dashboard/DashboardPage.tsx`
- Modify: `apps/web-react/src/features/dashboard/dashboard-order.ts`
- Modify: `apps/web-react/src/features/dashboard/dashboard.test.tsx`
- Modify: `packages/admin-contracts/src/surface.ts`
- Modify: `apps/web-react/src/styles/dashboard.css`

**Interfaces:**
- Consumes: `GET /api/activity/stream` via browser `EventSource`.
- Consumes: workspace summaries from existing Dashboard data.
- Produces: `Live MCP activity` Dashboard section that merges entries by operation id and shows running/success/error state.

- [ ] **Step 1: Write failing activity panel tests**

Provide a fake `EventSource`; emit a `running` event followed by a `success` update with the same id; assert one rendered row changes state and duration rather than duplicating.

- [ ] **Step 2: Update Dashboard ordering test**

Assert `live-mcp-activity` appears immediately after `runtime-overview`, while completed Onboarding remains last.

- [ ] **Step 3: Run Dashboard tests and verify they fail**

Run: `npm test -- --run apps/web-react/src/features/dashboard/McpActivityPanel.test.tsx apps/web-react/src/features/dashboard/dashboard.test.tsx`

Expected: FAIL because the panel/section does not exist.

- [ ] **Step 4: Implement panel and section**

Open one same-origin EventSource, merge `activity` events by id, cap client rows, show stream status, and render time/client/workspace/type/action/status/duration. Map workspace ids to names from Dashboard data. Guard environments where `EventSource` is unavailable so unit tests unrelated to the panel remain stable.

- [ ] **Step 5: Run web tests**

Run: `npm test -- --run apps/web-react/src/features/dashboard/McpActivityPanel.test.tsx apps/web-react/src/features/dashboard/dashboard.test.tsx apps/web-react/src/app/App.test.tsx`

Expected: PASS.

- [ ] **Step 6: Run full verification**

Run: `npm run typecheck && npm run lint && npm test`

Expected: all checks PASS.

- [ ] **Step 7: Commit**

Commit message: `feat(dashboard): show live MCP activity`
